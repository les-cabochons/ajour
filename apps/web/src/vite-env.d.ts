/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DESKTOP_SHELL?: string;
  readonly VITE_APP_API_BASE_URL?: string;
  /** `console` prints the renderer's wide events in the devtools console. */
  readonly AJOUR_WIDE_EVENTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
