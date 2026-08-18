import { getCurrentWindow } from "@tauri-apps/api/window";
import { DesktopWindowControls } from "@opaline/ui";
import { useEffect, useState } from "react";

export function ConstructDesktopWindowControls() {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const isWindowsDesktop = /Win/i.test(platform);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isWindowsDesktop) return;

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const refreshState = () => {
      void appWindow.isMaximized().then((maximized) => {
        if (!disposed) setIsMaximized(maximized);
      });
    };

    refreshState();
    void appWindow.onResized(refreshState).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isWindowsDesktop]);

  if (!isWindowsDesktop) return null;

  const appWindow = getCurrentWindow();
  return (
    <DesktopWindowControls
      className="fixed top-0 right-0 z-[250]"
      isMaximized={isMaximized}
      onClose={() => {
        void appWindow.close();
      }}
      onMinimize={() => {
        void appWindow.minimize();
      }}
      onToggleMaximize={() => {
        void appWindow.toggleMaximize().then(() => appWindow.isMaximized()).then(setIsMaximized);
      }}
    />
  );
}
