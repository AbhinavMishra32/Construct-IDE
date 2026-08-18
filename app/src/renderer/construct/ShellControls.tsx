import { useEffect, useRef, useState } from "react";
import { GearSix, Notebook } from "@phosphor-icons/react";
import { BookOpenIcon } from "lucide-react";
import { Spinner } from "@opaline/ui";

import { SparSidebarAction } from "../components/spar";

/**
 * The app's name, on the sidebar's first row.
 *
 * A wordmark rather than the mark it replaced: at 16px the mark was a shape too
 * small to be read as anything, sitting in the middle of a row with the traffic
 * lights on one side of it and nothing on the other. The name occupies that room
 * and says what the window is — which is the only job the first row has.
 */
export function ConstructWordmark() {
  return (
    <span aria-label="Construct" className="construct-wordmark">
      Construct
    </span>
  );
}

/* The panel icons that used to live here carried their own open state by stepping
   the stroke weight up. `SparToolbarIconButton` marks a pressed control with a
   fill, like the rest of the chrome does, so a second signal on the glyph was one
   control speaking twice — and the two never quite agreed, because a 2.1 stroke on
   an already-filled button just reads as a heavier icon. */

export function SidebarLearningButton({ onClick }: { onClick: () => void }) {
  return <SparSidebarAction icon={<Notebook />} label="Context" onClick={onClick} />;
}

export function SidebarConceptsButton({
  disabled = false,
  disabledReason,
  onClick
}: {
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <SparSidebarAction
      disabled={disabled}
      icon={<BookOpenIcon />}
      label="Concepts"
      onClick={disabled ? undefined : onClick}
      {...(disabledReason ? { title: disabledReason } : {})}
    />
  );
}

export function SidebarSettingsButton({ onClick }: { onClick: () => void }) {
  return <SparSidebarAction icon={<GearSix />} label="Settings" onClick={onClick} />;
}

export function SavingIndicator({ isSaving }: { isSaving: boolean }) {
  const [isVisible, setIsVisible] = useState(false);
  const saveStartRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isSaving) {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      if (!isVisible) {
        saveStartRef.current = Date.now();
        setIsVisible(true);
      }
    } else {
      if (isVisible && saveStartRef.current) {
        const elapsed = Date.now() - saveStartRef.current;
        const remainingTime = Math.max(0, 1000 - elapsed);

        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
        }

        hideTimeoutRef.current = setTimeout(() => {
          setIsVisible(false);
          hideTimeoutRef.current = null;
        }, remainingTime);
      }
    }
  }, [isSaving, isVisible]);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={`flex items-center gap-1 text-sm text-muted-foreground transition-opacity ${isVisible ? "opacity-100" : "opacity-0"}`}>
      <Spinner aria-hidden="true" />
      <span>Saving...</span>
    </div>
  );
}
