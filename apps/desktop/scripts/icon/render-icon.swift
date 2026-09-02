// Renders one size of the Spar app icon, in either appearance.
//
// usage: swift render-icon.swift <size> <dark|light> <out.png>
//
// The geometry here is measured, not guessed. See scripts/icon/README.md for how
// the two numbers below were fitted against the shape macOS itself draws.

import AppKit
import QuartzCore
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 4, let size = Int(args[1]), size > 0,
      args[2] == "dark" || args[2] == "light" else {
  fputs("usage: render-icon.swift <size> <dark|light> <out.png>\n", stderr)
  exit(1)
}
let isDark = args[2] == "dark"
let outURL = URL(fileURLWithPath: args[3])

// macOS 26 icon geometry. The artwork box is 824/1024 of the canvas, and the
// corner is Apple's continuous curve at 0.2597 of that box.
let boxScale: CGFloat = 824.0 / 1024.0
let cornerRatio: CGFloat = 0.2597

// The mark: a 5x5 field of dots lit from a single centre. Size and tone fall away
// with straight-line distance from that dot, so what glows is a disc rather than a
// square — the corners are the furthest thing from the middle and read as such,
// which a square falloff cannot say. An odd grid is deliberate: there is a middle
// cell, and the mark is built around the one dot that sits in it.
let gridCount = 5
let gridMargin: CGFloat = 0.175      // of the artwork box, to the outer dot centres
let dotFill: CGFloat = 0.72          // largest dot as a fraction of the grid step
/* The floor is high on purpose. The corners are the edge of the mark and the
   thing that holds its square footprint — drop them too far and the field
   collapses to a blob in the middle with dust round it. At half the centre dot's
   size and nearly two-thirds its alpha the rim is plainly lit; the centre is still
   unmistakably the centre. */
let minScale: CGFloat = 0.50         // at the corners, as a fraction of the largest
let minTone: CGFloat = 0.62          // at the corners
/* Slightly under 1, so the middle ring sits nearer the core than a straight
   line would put it and the falloff happens mostly at the rim. */
let ease: CGFloat = 0.85

let S = CGFloat(size)
let box = S * boxScale
let inset = (S - box) / 2
let corner = box * cornerRatio
let boxRect = CGRect(x: inset, y: inset, width: box, height: box)

let space = CGColorSpace(name: CGColorSpace.sRGB)!
let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue

func newContext() -> (CGContext, UnsafeMutableRawPointer) {
  let bytes = UnsafeMutableRawPointer.allocate(byteCount: size * size * 4, alignment: 8)
  bytes.initializeMemory(as: UInt8.self, repeating: 0, count: size * size * 4)
  let ctx = CGContext(data: bytes, width: size, height: size, bitsPerComponent: 8,
                      bytesPerRow: size * 4, space: space, bitmapInfo: bitmapInfo)!
  ctx.interpolationQuality = .high
  return (ctx, bytes)
}

func gray(_ value: CGFloat, _ alpha: CGFloat = 1) -> CGColor {
  CGColor(srgbRed: value, green: value, blue: value, alpha: alpha)
}

/// Apple's continuous corner has no public CGPath constructor, so this takes the
/// real curve from a CALayer and returns its coverage as an 8-bit clip mask.
/// Passing a border width returns just the rim instead of the filled shape.
func squircleMask(border: CGFloat? = nil) -> CGImage {
  let (ctx, bytes) = newContext()
  defer { bytes.deallocate() }
  let layer = CALayer()
  layer.frame = CGRect(x: 0, y: 0, width: box, height: box)
  layer.cornerRadius = corner
  layer.cornerCurve = .continuous
  if let border {
    layer.borderWidth = border
    layer.borderColor = NSColor.white.cgColor
  } else {
    layer.backgroundColor = NSColor.white.cgColor
    layer.masksToBounds = true
  }
  // render(in:) draws at the context origin and ignores the layer's position, so
  // the centring has to come from the transform.
  ctx.translateBy(x: inset, y: inset)
  layer.render(in: ctx)
  let rendered = ctx.makeImage()!

  let alphaBytes = UnsafeMutableRawPointer.allocate(byteCount: size * size, alignment: 8)
  defer { alphaBytes.deallocate() }
  let alphaCtx = CGContext(data: alphaBytes, width: size, height: size, bitsPerComponent: 8,
                           bytesPerRow: size, space: CGColorSpaceCreateDeviceGray(),
                           bitmapInfo: CGImageAlphaInfo.none.rawValue)!
  alphaCtx.setFillColor(NSColor.black.cgColor)
  alphaCtx.fill(CGRect(x: 0, y: 0, width: S, height: S))
  alphaCtx.draw(rendered, in: CGRect(x: 0, y: 0, width: S, height: S))
  return alphaCtx.makeImage()!
}

let (ctx, bytes) = newContext()
defer { bytes.deallocate() }
let full = CGRect(x: 0, y: 0, width: S, height: S)

ctx.saveGState()
ctx.clip(to: full, mask: squircleMask())

// Ground: a vertical ramp in the app's own neutral scale, lit from the top the
// way macOS renders every other icon. The light appearance is the same mark with
// the ink and the ground exchanged, not a separate design.
let ground = isDark
  ? CGGradient(colorsSpace: space,
               colors: [gray(0.204), gray(0.145), gray(0.055)] as CFArray,
               locations: [0, 0.55, 1])!
  : CGGradient(colorsSpace: space,
               colors: [gray(1.0), gray(0.976), gray(0.925)] as CFArray,
               locations: [0, 0.55, 1])!
ctx.drawLinearGradient(ground,
                       start: CGPoint(x: 0, y: boxRect.maxY),
                       end: CGPoint(x: 0, y: boxRect.minY),
                       options: [])

// A wide, faint specular pool under the top edge: the sheen a glass surface
// gets, kept low enough that it never reads as a separate shape.
let sheen = CGGradient(colorsSpace: space,
                       colors: [gray(1, isDark ? 0.10 : 0.55), gray(1, 0)] as CFArray,
                       locations: [0, 1])!
let sheenCentre = CGPoint(x: S / 2, y: boxRect.maxY + box * 0.10)
ctx.drawRadialGradient(sheen,
                       startCenter: sheenCentre, startRadius: 0,
                       endCenter: sheenCentre, endRadius: box * 0.62,
                       options: [])

// The falloff. Row 0 is the top row so the layout can be read in reading order.
//
// Distance is straight-line — hypot of the row and column offsets — which is what
// makes the light round. The grid is odd, so the centre dot sits at distance 0 and
// takes the full weight on its own; the corners at hypot(mid, mid) are the far end
// of the ramp.
let field = box * (1 - 2 * gridMargin)
let step = field / CGFloat(gridCount - 1)
let largestDot = step * dotFill
let mid = CGFloat(gridCount - 1) / 2
let furthest = (mid * mid * 2).squareRoot()

for row in 0..<gridCount {
  for column in 0..<gridCount {
    let dx = CGFloat(row) - mid
    let dy = CGFloat(column) - mid
    let distance = (dx * dx + dy * dy).squareRoot()
    // 1 at the centre dot, 0 at the corners: weight is spent in the middle and
    // spread thin at the rim.
    let weight = pow(1 - distance / furthest, ease)
    let scale = minScale + (1 - minScale) * weight
    let tone = minTone + (1 - minTone) * weight
    let centre = CGPoint(x: boxRect.minX + box * gridMargin + CGFloat(column) * step,
                         y: boxRect.maxY - box * gridMargin - CGFloat(row) * step)
    let radius = largestDot * scale / 2
    ctx.setFillColor(gray(isDark ? 1 : 0.07, tone))
    ctx.fillEllipse(in: CGRect(x: centre.x - radius, y: centre.y - radius,
                               width: radius * 2, height: radius * 2))
  }
}

ctx.restoreGState()

// Edge treatment, drawn inside the silhouette so the outline stays exactly
// Apple's. On dark, a rim light along the top keeps the icon from reading as a
// flat sticker next to native ones; on light, a hairline all the way round keeps
// a near-white icon from dissolving into a light Dock or a white page.
ctx.saveGState()
ctx.clip(to: full, mask: squircleMask())
ctx.clip(to: full, mask: squircleMask(border: max(1, S / 340) * 2))
if isDark {
  let rim = CGGradient(colorsSpace: space,
                       colors: [gray(1, 0.22), gray(1, 0.04), gray(1, 0)] as CFArray,
                       locations: [0, 0.45, 1])!
  ctx.drawLinearGradient(rim,
                         start: CGPoint(x: 0, y: boxRect.maxY),
                         end: CGPoint(x: 0, y: boxRect.minY),
                         options: [])
} else {
  let rim = CGGradient(colorsSpace: space,
                       colors: [gray(0, 0.05), gray(0, 0.12)] as CFArray,
                       locations: [0, 1])!
  ctx.drawLinearGradient(rim,
                         start: CGPoint(x: 0, y: boxRect.maxY),
                         end: CGPoint(x: 0, y: boxRect.minY),
                         options: [])
}
ctx.restoreGState()

guard let image = ctx.makeImage(),
      let destination = CGImageDestinationCreateWithURL(
        outURL as CFURL, UTType.png.identifier as CFString, 1, nil)
else {
  fputs("could not encode \(outURL.path)\n", stderr)
  exit(1)
}
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else {
  fputs("could not write \(outURL.path)\n", stderr)
  exit(1)
}
