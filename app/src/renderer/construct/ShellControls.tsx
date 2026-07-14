import { useEffect, useRef, useState } from "react";
import { GearSix, Notebook } from "@phosphor-icons/react";
import { BookOpenIcon, PanelBottomIcon, PanelRightIcon } from "lucide-react";
import { Spinner, SidebarMenuButton } from "@opaline/ui";


export function HeaderGuidePanelIcon({ open }: { open: boolean }) {
  return <PanelRightIcon aria-hidden="true" className="size-[16px]" strokeWidth={open ? 2.1 : 1.9} />;
}

export function HeaderBottomPanelIcon({ open }: { open: boolean }) {
  return <PanelBottomIcon aria-hidden="true" className="size-[16px]" strokeWidth={open ? 2.1 : 1.9} />;
}

export function SidebarLearningButton({ onClick }: { onClick: () => void }) {
  return (
    <SidebarMenuButton onClick={onClick}>
      <Notebook className="size-4" />
      <span>Context</span>
    </SidebarMenuButton>
  );
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
    <SidebarMenuButton
      aria-label={disabled && disabledReason ? disabledReason : "Open Concepts"}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      title={disabledReason}
    >
      <BookOpenIcon className="size-4" />
      <span>Concepts</span>
    </SidebarMenuButton>
  );
}

export function SidebarSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <SidebarMenuButton onClick={onClick}>
      <GearSix className="size-4" />
      <span>Settings</span>
    </SidebarMenuButton>
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
