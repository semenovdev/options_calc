import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: {
      '/moex-option-calc': {
        target: 'https://iss.moex.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/moex-option-calc/, '/iss/apps/option-calc/v1'),
      },
      '/moex-iss': {
        target: 'https://iss.moex.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/moex-iss/, '/iss'),
      },
    },
  },
})
