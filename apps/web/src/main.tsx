import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppRouter } from "@/router";
import "@/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider>
      <AppRouter />
      <Toaster />
    </TooltipProvider>
  </React.StrictMode>,
);
