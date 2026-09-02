import { useEffect, useState } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { cn } from "@/lib/utils";

/**
 * Construct working, wherever it is working.
 *
 * One wrapper rather than a `ThinkingOrb` spelled out at each site, because the
 * two things every site has to get right are easy to get wrong separately: the
 * pixel size (the package ships two tuned designs, 20 and 64, and everything
 * inline wants the 20 scaled down by `style`) and the ink.
 *
 * The orb replaced the spinning Lucide ring nearly everywhere it stood. A
 * rotating arc is a progress bar with the progress taken out. These say what
 * kind of work is happening, and there are nine of them.
 */
export function Orb({
  className,
  invert = false,
  label = "Working",
  px = 15,
  speed,
  state = "working",
}: {
  className?: string;
  /** For an orb on an inverted surface — a filled button, whose background is
   *  the foreground colour and so runs opposite to the app's own theme. */
  invert?: boolean;
  label?: string;
  px?: number;
  speed?: number;
  state?: OrbState;
}) {
  const dark = useDarkMode();
  return (
    <ThinkingOrb
      aria-label={label}
      className={cn("shrink-0", className)}
      size={20}
      speed={speed}
      state={state}
      style={{ width: px, height: px }}
      /* `auto` reads the `dark` class off the root, which is right everywhere
         except on top of a fill that inverts it. */
      theme={invert ? (dark ? "light" : "dark") : "auto"}
    />
  );
}

/** Whether the app is in dark mode right now, kept live. */
function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const watch = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    watch.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => watch.disconnect();
  }, []);
  return dark;
}
