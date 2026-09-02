import React from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { TooltipProvider } from "./components/ui/tooltip";
import { App } from "./App";
import { CodeThemeProvider, readCodeThemeSettings } from "./hooks/use-code-theme";
import { startEditorPlatform } from "./lib/monaco/services";
import { installSourceFileSystem } from "./lib/monaco/fileSystem";
import { codeThemeConfiguration } from "./lib/monaco-theme";
import { resolveCodeTheme } from "../shared/codeTheme";
import { UpdateExperience } from "./components/updates/UpdateExperience";
import "./theme.css";

/* The first frame only. App owns the class from then on, resolving the stored
   preference and following the system while it is "system" — this line exists
   so the very first paint is not light on a dark desktop. */
document.documentElement.classList.toggle("dark", matchMedia("(prefers-color-scheme: dark)").matches);

// Chrome the OS owns. Both land before first paint — the sidebar is a
// transparent hole over the native material, and it has to know on frame one
// whether there is a material back there and which edge the buttons occupy.
// The main process re-sends the surface once it knows whether Liquid Glass
// actually attached, since that can still fall back to plain vibrancy.
const chrome = window.construct?.chrome;
document.documentElement.dataset.nativeSurface = chrome?.surface ?? "none";
document.documentElement.dataset.windowControls = chrome?.controls ?? "left";
window.construct?.onNativeSurface((surface) => {
  document.documentElement.dataset.nativeSurface = surface;
});
// The themes read resolved CSS variables, so they are defined after the stylesheet applies.

/* The editor platform comes up before React does.
 *
 * Awaited rather than started in an effect: a text model created before the
 * language and theme services exist has no grammar and no colour, and nothing
 * repaints it once they arrive. The palette is resolved from the same store the
 * provider reads, so the platform starts on the theme it will keep. */
const appearance = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
await startEditorPlatform(codeThemeConfiguration(resolveCodeTheme(readCodeThemeSettings(), appearance)));

/* And then the disk, which is what makes the platform's file service worth
   having. Registered here rather than per project: a definition can lead
   anywhere, so the provider is not scoped to one directory — see
   `installSourceFileSystem`. */
if (window.construct) installSourceFileSystem(window.construct);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      {/* Mounted at the root rather than per surface. Radix's Tooltip throws
          rather than degrading when no provider is above it, so a single
          tooltip added to any screen would otherwise take the whole render
          tree down with it — which is exactly what happened. */}
      <TooltipProvider delayDuration={400}>
        {/* Above App, because it writes the `--code-*` variables and defines
            Monaco's theme — both of which have to be in place before anything
            that draws code first paints. */}
        <CodeThemeProvider>
          <App />
          {window.construct && <UpdateExperience api={window.construct} />}
        </CodeThemeProvider>
      </TooltipProvider>
    </MotionConfig>
  </React.StrictMode>,
);
