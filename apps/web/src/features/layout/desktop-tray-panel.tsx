import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { PortalContainer } from "@/components/ui/portal-container";
import { Toaster } from "@/components/ui/toast";

const Panel = lazy(async () => ({
  default: (await import("./compact-timer-panel")).CompactTimerPanel,
}));

/** A child document, not another application. All hooks and commands run in the owner. */
export function DesktopTrayPanel() {
  const childRef = useRef<Window | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let themeObserver: MutationObserver | undefined;
    const unsubscribe = window.ajourDesktop?.onTrayPanel?.((command) => {
      if (command === "hide") {
        setVisible(false);
        return;
      }
      if (command === "show") {
        setVisible(true);
        return;
      }
      if (childRef.current && !childRef.current.closed) {
        setVisible(true);
        return;
      }
      const child = window.open(
        "about:blank",
        "ajour-tray-panel",
        "width=360,height=680,show=no",
      );
      if (!child) {
        window.ajourDesktop?.trayPanelCommand?.("hide");
        return;
      }
      childRef.current = child;
      const doc = child.document;
      doc.title = "Ajour timer";
      doc.documentElement.lang = document.documentElement.lang;
      const base = doc.createElement("base");
      base.href = document.baseURI;
      doc.head.append(base);
      const stylesReady = [
        ...document.querySelectorAll('link[rel="stylesheet"], style'),
      ].map((sheet) => {
        const copy = sheet.cloneNode(true);
        const ready =
          sheet instanceof HTMLLinkElement
            ? new Promise<void>((resolve) => {
                copy.addEventListener("load", () => resolve(), { once: true });
                copy.addEventListener("error", () => resolve(), { once: true });
              })
            : Promise.resolve();
        doc.head.append(copy);
        return ready;
      });
      const applyTheme = () => {
        doc.documentElement.className = document.documentElement.className;
        doc.documentElement.style.cssText =
          document.documentElement.style.cssText;
      };
      applyTheme();
      themeObserver?.disconnect();
      themeObserver = new MutationObserver(applyTheme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
      const root = doc.createElement("div");
      root.id = "root";
      doc.body.append(root);
      child.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          window.ajourDesktop?.trayPanelCommand?.("hide");
        }
      });
      child.addEventListener(
        "beforeunload",
        () => {
          childRef.current = null;
          setContainer(null);
          setVisible(false);
          themeObserver?.disconnect();
        },
        { once: true },
      );
      void Promise.all(stylesReady).then(() => {
        if (childRef.current !== child || child.closed) return;
        setContainer(root);
        setVisible(true);
      });
    });
    return () => {
      unsubscribe?.();
      themeObserver?.disconnect();
      childRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (container && visible) window.ajourDesktop?.trayPanelCommand?.("ready");
  }, [container, visible]);

  if (!container || !visible) return null;
  const openApp = () => window.ajourDesktop?.trayPanelCommand?.("open-main");
  return createPortal(
    <PortalContainer value={container.ownerDocument.body}>
      <Suspense
        fallback={
          <div className="p-3 text-xs text-muted-foreground">
            Loading timer…
          </div>
        }
      >
        <Panel
          onDismiss={() => window.ajourDesktop?.trayPanelCommand?.("hide")}
          onOpenApp={openApp}
          onOpenTask={(id) => {
            void navigate({
              to: "/backlog/$itemId",
              params: { itemId: id },
              search: { from: "backlog" },
            });
            openApp();
          }}
        />
      </Suspense>
      <Toaster />
    </PortalContainer>,
    container,
  );
}
