/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DESKTOP_SHELL?: string;
  readonly VITE_APP_API_BASE_URL?: string;
  /** `true` when the page calls `/api` through the dev server's proxy. */
  readonly VITE_APP_API_THROUGH_PROXY?: string;
  /** `console` prints the renderer's wide events in the devtools console. */
  readonly AJOUR_WIDE_EVENTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
