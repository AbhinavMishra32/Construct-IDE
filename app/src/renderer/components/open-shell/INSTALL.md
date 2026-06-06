# Open Shell UI

These files were installed by `scripts/install-open-shell-ui.mjs`.

This is intentionally shadcn-style: the source is copied into your app, not imported from a published package.
You own these files now. Edit them, theme them, and wire them to your product data.

## Usage

```tsx
import "@/components/open-shell/tokens/codex-theme.css";
import { AppShell, Composer, Sidebar, ThreadSurface } from "@/components/open-shell";
```

## Required packages

- `@radix-ui/react-context-menu`
- `@radix-ui/react-dialog`
- `@radix-ui/react-dropdown-menu`
- `@radix-ui/react-slot`
- `@radix-ui/react-tabs`

React and React DOM are expected to already exist in the target app.
