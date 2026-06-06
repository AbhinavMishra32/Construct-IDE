import React from "react";
import ReactDOM from "react-dom/client";

import AppV2 from "./v2/AppV2";
import { TooltipProvider } from "./components/ui/tooltip";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <AppV2 />
    </TooltipProvider>
  </React.StrictMode>
);
