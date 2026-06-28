import { useEffect, useRef, useState } from "react";
import { GearSix, Notebook } from "@phosphor-icons/react";
import { BookOpenIcon } from "lucide-react";
import { Button, Spinner } from "@opaline/ui";


export function HeaderGuidePanelIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.25" y="4" width="13.5" height="12" rx="2.75" />
      <path d="M10 4v12" />
      {open ? (
        <path d="M7.5 8 5.75 10l1.75 2" />
      ) : null}
    </svg>
  );
}

export function HeaderBottomPanelIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.25" y="4" width="13.5" height="12" rx="2.75" />
      <path d="M3.25 10.75h13.5" />
      {open ? (
        <path d="m8 8.2 2-2 2 2" />
      ) : null}
    </svg>
  );
}

export function SidebarLearningButton({ onClick }: { onClick: () => void }) {
  return (
    <Button className="h-[30px] w-full justify-start gap-2.5 rounded-[6px] px-2.5 text-[12.5px] font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={onClick} variant="ghost">
      <span className="grid size-[18px] shrink-0 place-items-center" data-icon="inline-start" aria-hidden="true">
        <Notebook className="size-[15px]" />
      </span>
      <span>Context</span>
    </Button>
  );
}

export function SidebarConceptsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button className="h-[30px] w-full justify-start gap-2.5 rounded-[6px] px-2.5 text-[12.5px] font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={onClick} variant="ghost">
      <span className="grid size-[18px] shrink-0 place-items-center" data-icon="inline-start" aria-hidden="true">
        <BookOpenIcon className="size-[15px]" />
      </span>
      <span>Concepts</span>
    </Button>
  );
}

export function SidebarSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button className="h-[30px] w-full justify-start gap-2.5 rounded-[6px] px-2.5 text-[12.5px] font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={onClick} variant="ghost">
      <span className="grid size-[18px] shrink-0 place-items-center" data-icon="inline-start" aria-hidden="true">
        <GearSix className="size-[15px]" />
      </span>
      <span>Settings</span>
    </Button>
  );
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
