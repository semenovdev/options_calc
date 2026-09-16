/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTO_REFRESH_INTERVAL_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
