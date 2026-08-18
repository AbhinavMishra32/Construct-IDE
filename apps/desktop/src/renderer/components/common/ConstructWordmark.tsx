import { cn } from "@/lib/utils";

/** The product wordmark deliberately uses Poppins, while the application UI is set in the
 *  platform's own face (SF Pro on macOS, Segoe UI Variable on Windows). Poppins carries the
 *  taller x-height of the two, so the default size is expressed in `em` and trimmed slightly:
 *  dropped into a sentence the wordmark then optically matches the copy around it instead of
 *  bulging out of the line. Callers that stand the wordmark on its own (sign-in, sidebar
 *  header) pass an explicit size. */
export function ConstructWordmark({ className }: { className?: string }) {
  return (
    <span
      aria-label="Construct"
      className={cn("font-construct text-[0.94em] font-semibold tracking-[-0.055em] whitespace-nowrap", className)}
    >
      Construct
    </span>
  );
}
