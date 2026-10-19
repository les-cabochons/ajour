import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { installLockedWeekToast } from "@/features/feedback/locked-week-toast";
import { AppRouter } from "@/router";
import "@/styles.css";

installLockedWeekToast();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider>
      <AppRouter />
      <Toaster />
    </TooltipProvider>
  </React.StrictMode>,
);
