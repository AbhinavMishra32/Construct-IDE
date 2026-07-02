import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct IconMaskError: Error, CustomStringConvertible {
  let description: String
}

let args = CommandLine.arguments
guard args.count == 6 else {
  throw IconMaskError(description: "usage: mask-macos-icon.swift <source.png> <reference-app-or-mask.png> <size> <content-scale> <output.png>")
}

let sourceURL = URL(fileURLWithPath: args[1])
let referenceURL = URL(fileURLWithPath: args[2])
guard let requestedSize = Int(args[3]), requestedSize > 0 else {
  throw IconMaskError(description: "icon size must be a positive integer")
}
guard let contentScale = Double(args[4]), contentScale > 0, contentScale <= 1 else {
  throw IconMaskError(description: "content scale must be greater than 0 and no greater than 1")
}
let outputURL = URL(fileURLWithPath: args[5])

func loadImage(_ url: URL) throws -> CGImage {
  guard
    let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    throw IconMaskError(description: "could not read image: \(url.path)")
  }
  return image
}

let sourceImage = try loadImage(sourceURL)
let maskImage: CGImage
if referenceURL.pathExtension == "app" {
  let icon = NSWorkspace.shared.icon(forFile: referenceURL.path)
  icon.size = NSSize(width: requestedSize, height: requestedSize)
  guard
    let tiff = icon.tiffRepresentation,
    let rendered = NSBitmapImageRep(data: tiff),
    let renderedImage = rendered.cgImage
  else {
    throw IconMaskError(description: "could not render macOS reference icon: \(referenceURL.path)")
  }
  maskImage = renderedImage
} else {
  maskImage = try loadImage(referenceURL)
}

let width = requestedSize
let height = requestedSize
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue

let bounds = CGRect(x: 0, y: 0, width: width, height: height)

let byteCount = width * height * 4
var sourcePixels = [UInt8](repeating: 0, count: byteCount)
var maskPixels = [UInt8](repeating: 0, count: byteCount)

guard
  let sourceContext = CGContext(
    data: &sourcePixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: colorSpace,
    bitmapInfo: bitmapInfo
  ),
  let maskContext = CGContext(
    data: &maskPixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: colorSpace,
    bitmapInfo: bitmapInfo
  )
else {
  throw IconMaskError(description: "could not create pixel contexts")
}

sourceContext.interpolationQuality = .high
maskContext.interpolationQuality = .high
sourceContext.setFillColor(NSColor.white.cgColor)
sourceContext.fill(bounds)
let contentSide = CGFloat(width) * CGFloat(contentScale)
let contentOrigin = (CGFloat(width) - contentSide) / 2
let contentRect = CGRect(x: contentOrigin, y: contentOrigin, width: contentSide, height: contentSide)
sourceContext.draw(sourceImage, in: contentRect)
maskContext.draw(maskImage, in: bounds)

for offset in stride(from: 0, to: byteCount, by: 4) {
  let sourceAlpha = UInt16(sourcePixels[offset + 3])
  let maskAlpha = UInt16(maskPixels[offset + 3])
  sourcePixels[offset + 3] = UInt8((sourceAlpha * maskAlpha) / 255)
}

guard
  let maskedProvider = CGDataProvider(data: Data(sourcePixels) as CFData),
  let outputImage = CGImage(
    width: width,
    height: height,
    bitsPerComponent: 8,
    bitsPerPixel: 32,
    bytesPerRow: width * 4,
    space: colorSpace,
    bitmapInfo: CGBitmapInfo(rawValue: bitmapInfo),
    provider: maskedProvider,
    decode: nil,
    shouldInterpolate: false,
    intent: .defaultIntent
  ),
  let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.png.identifier as CFString, 1, nil)
else {
  throw IconMaskError(description: "could not create output image: \(outputURL.path)")
}

CGImageDestinationAddImage(destination, outputImage, nil)
if !CGImageDestinationFinalize(destination) {
  throw IconMaskError(description: "could not write output image: \(outputURL.path)")
}
