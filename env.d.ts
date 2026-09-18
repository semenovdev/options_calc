/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPTION_CALC_BASE_URL?: string
  readonly VITE_AUTO_REFRESH_INTERVAL_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
