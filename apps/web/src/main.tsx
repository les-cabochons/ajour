import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { installAppErrorHandler } from "@/features/feedback/app-error-handler";
import { startAppBoot } from "@/lib/app-boot";
import { AppRouter } from "@/router";
import "@/styles.css";

installAppErrorHandler();
const boot = startAppBoot();

/** Ends the boot's event once the app has committed its first render. */
function BootRendered() {
  useEffect(() => boot.rendered(), []);
  return null;
}

ReactDOM.createRoot(document.getElementById("root")!, {
  // A render that fails before the first commit ends the boot's event with
  // its error. The error then goes on to the window, as React reports it.
  onUncaughtError(error) {
    boot.failed(error);
    globalThis.reportError(error);
  },
}).render(
  <React.StrictMode>
    <TooltipProvider>
      <AppRouter />
      <Toaster />
      <BootRendered />
    </TooltipProvider>
  </React.StrictMode>,
);
