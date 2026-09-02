# App icon

`pnpm --filter @spar/desktop icons` regenerates every icon artifact from
`render-icon.swift`. The outputs are committed because rendering needs AppKit —
the Windows and Linux release jobs package what is in the repository.

| Output | Used by |
| --- | --- |
| `build/icon.icns` | macOS app bundle |
| `build/icon.ico` | Windows installer and executable |
| `build/icons/*.png` | Linux AppImage, deb, and rpm |
| `build/runtime-icons/{dark,light}.png` | the Dock icon the running app swaps by appearance |
| `docs/assets/icon-{dark,light}.png` | README and docs |

## The shape

macOS 26 puts every app icon in the same squircle, so an icon that draws its own
approximation of that shape looks subtly wrong next to the ones that don't. Two
numbers define it, and both were measured against the shape the system itself
draws rather than taken from a blog post:

- **Artwork box: 824/1024 of the canvas, centred.** A 1024px icns is rendered by
  macOS with the artwork inset by 100px on each side. Reading the alpha of a
  system icon (`/System/Applications/App Store.app`) at 1024px gives a solid edge
  at exactly x=100 and y=100.
- **Corner: Apple's continuous curve at 0.2597 of the box — 214px at 1024.** The
  continuous corner has no public `CGPath` constructor, so the fit was done by
  rendering `CALayer` with `cornerCurve = .continuous` across a range of radii and
  comparing each corner's alpha profile against the system icon's. 214px wins at
  0.84px RMSE, which is inside antialiasing. For reference, the Big Sur era used
  185.4px (0.225) on the same box: Tahoe's corner is visibly rounder, which is why
  a Big Sur radius now reads as too square.

`render-icon.swift` therefore does not build a squircle path at all. It renders
that same `CALayer` and uses its coverage as a clip mask, so the silhouette is
Apple's own curve at every size instead of a bezier approximation of it.

## The mark

A 5×5 field of dots lit from a single centre. Size and tone both fall away with
straight-line distance from that dot, so the middle is at full weight and the
corners are the faintest thing in the mark.

Two decisions carry it. The falloff is **radial** — hypot of the row and column
offsets, not the larger of the two — so what glows is a disc inside a square
footprint. A Chebyshev falloff makes square rings, which puts the corners at the
same weight as the edge midpoints and reads as a frame rather than as light. And
the grid is **odd**, so there is a middle cell: the mark is built around the one
dot that sits in it, at full weight, with everything else measured from there.

Five numbers define it, all at the top of `render-icon.swift` and all mirrored in
`src/renderer/components/common/ConstructDots.tsx`, which animates the same field
for loading states:

- **Grid: 5×5.** The ramp runs from 0 at the centre dot to hypot(2, 2) at the
  corners.
- **Margin: 0.175 of the artwork box** to the outer dot centres. Sized so the
  corner dots clear the squircle's curve rather than being clipped by it.
- **Dot fill: 0.72** of the grid step, for the largest ring.
- **Corners: 0.50 of that size and 0.62 alpha**, ramping to 1.0 at the centre. The
  floor is high on purpose. The corners hold the mark's square footprint; taken
  much below half, they stop holding it and the field collapses into a blob in the
  middle with dust around it.
- **Ease: 0.85.** Slightly under 1, so the mid dots sit nearer the centre than a
  straight line would put them and most of the falloff happens at the rim.

Both appearances are the same mark with the ink and the ground exchanged: dark is
white dots on a graphite ramp, light is near-black dots on an off-white one. The
palette stays on the app's own neutral `oklch(_ 0 0)` scale.

The same field tiles the sign-in window's backdrop — see `.auth-field` in
`theme.css`, where the motif is a mask over `currentColor` so it inherits the
window's text colour in both appearances. Its ramp runs the other way, heavy at
the outside and light at the core: as a mark the weight belongs at the centre so
the eye lands there, but as wallpaper a heavy centre gives every tile a bright
spot and the field reads as a grid of blobs. Inverted, the tiles meet edge to
edge and read as one continuous texture.

## Light and dark

macOS 26 can carry per-appearance app icons, but only through an Icon Composer
`.icon` compiled into an asset catalog. The legacy `.icns` that electron-builder
packages has no field for a second appearance, so the bundle icon is a single
image: the dark mark.

What the app can do is set its own Dock icon while it runs, so `main/dockIcon.ts`
swaps `build/runtime-icons/{dark,light}.png` from `nativeTheme` and follows
appearance changes live. Finder, Launchpad, and the DMG still show the dark mark
from the bundle.
