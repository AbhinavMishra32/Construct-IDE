# Opaline UI workflow

Construct consumes Opaline through the local workspace package `@opaline/ui`.
Opaline lives in the `opaline` submodule and remains a standalone publishable
npm package.

When changing Construct UI, first check whether the desired behavior belongs in
Opaline as a generic component improvement. Prefer adding reusable primitives,
layout props, visual tokens, or composition hooks in `opaline/packages/ui`, then
consume those APIs from Construct. Keep Construct-specific workflows, copy, data
loading, and tape state in Construct.

New Construct UI should use Opaline's shadcn/Base UI export before local markup:

```tsx
import { Item, Kbd, ToggleGroup, ToggleGroupItem } from "@opaline/ui/shadcn";
```

Use `Item` for settings pages and dense object rows, `Kbd` for every displayed
keyboard shortcut, and `ToggleGroup` for grouped panel or mode buttons. Keep
classic Opaline exports such as `AppShell`, `Sidebar`, `SlotPanel`,
`BottomPanel`, `ThreadSurface`, `FileTree`, `Composer`, and `SettingsPanel` for
IDE chrome and shell-level systems.

Construct compiles Tailwind against `../opaline/packages/ui/src`, so shadcn
classes authored inside Opaline work locally without publishing. When adding a
new shadcn component, expose it through `@opaline/ui/shadcn` and keep any
Construct-specific styling in Construct CSS only when a component variant does
not already cover the need.

Local development does not require publishing. Construct's pnpm workspace
includes `opaline/packages/*`, and `@construct/app` depends on
`@opaline/ui` via `workspace:*`, so changes to Opaline source can be built and
typechecked locally before package publication.
