import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { useControlledState } from "@/hooks/use-controlled-state";
import { cn } from "@/lib/utils";
import { overlaySurfaceVariants } from "@/components/ui/overlay-motion";

/* Mirrors Radix's open state so AnimatePresence, not Radix, decides when the
   panel leaves the tree — otherwise there is nothing left to animate out. The
   same arrangement the hover card uses, for the same reason. */
const PopoverOpenContext = React.createContext(false);

/**
 * A panel that opens on click and holds real content.
 *
 * The hover card's sibling, and the distinction is the pointer: a hover card
 * appears while you are on the way somewhere else, so it has to be cheap to
 * dismiss and cannot hold anything you would want to interact with. This opens
 * because you asked, stays until you are done, and its contents can be clicked.
 */
function Popover({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const [isOpen, setIsOpen] = useControlledState<boolean>({
    ...(open === undefined ? {} : { value: open }),
    defaultValue: defaultOpen ?? false,
    ...(onOpenChange ? { onChange: onOpenChange } : {}),
  });

  return (
    <PopoverOpenContext.Provider value={isOpen}>
      <PopoverPrimitive.Root
        data-slot="popover"
        onOpenChange={setIsOpen}
        {...(open === undefined ? {} : { open })}
        {...(defaultOpen === undefined ? {} : { defaultOpen })}
        {...props}
      />
    </PopoverOpenContext.Provider>
  );
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverContent({
  className,
  align = "start",
  side = "bottom",
  sideOffset = 8,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const isOpen = React.useContext(PopoverOpenContext);
  const reduced = useReducedMotion() ?? false;
  const surface = React.useMemo(() => overlaySurfaceVariants({ side, reduced }), [side, reduced]);

  return (
    <AnimatePresence>
      {isOpen && (
        <PopoverPrimitive.Portal forceMount>
          <PopoverPrimitive.Content align={align} asChild forceMount side={side} sideOffset={sideOffset} {...props}>
            <motion.div
              animate="visible"
              className={cn(
                "floating-surface z-50 origin-(--radix-popover-content-transform-origin) text-popover-foreground outline-none",
                "data-closed:pointer-events-none",
                className,
              )}
              data-slot="popover-content"
              exit="exit"
              initial="hidden"
              variants={surface}
            >
              {children}
            </motion.div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
