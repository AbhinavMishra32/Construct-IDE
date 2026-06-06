import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";
import ConstructApp from "./construct/App";
import { TooltipProvider } from "./components/ui/tooltip";

const os =
  navigator.userAgent.includes("Windows") || navigator.platform.toLowerCase().startsWith("win")
    ? "win32"
    : navigator.userAgent.includes("Linux") || navigator.platform.toLowerCase().includes("linux")
      ? "linux"
      : "darwin";

document.documentElement.dataset.codexWindowType = "electron";
document.documentElement.dataset.windowType = "electron";
document.documentElement.dataset.codexOs = os;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <ConstructApp />
    </TooltipProvider>
  </React.StrictMode>
);
