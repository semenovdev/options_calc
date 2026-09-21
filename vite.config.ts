import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const optionCalcProxyTarget = env.VITE_OPTION_CALC_PROXY_TARGET || 'https://iss.moex.com'
  const useCustomOptionCalcProxy = Boolean(env.VITE_OPTION_CALC_PROXY_TARGET)

  return {
    plugins: [vue()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      proxy: {
        '/moex-option-calc': {
          target: optionCalcProxyTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyRes', (response) => {
              delete response.headers['set-cookie']
            })
          },
          rewrite: (path) =>
            path.replace(
              /^\/moex-option-calc/,
              useCustomOptionCalcProxy ? '' : '/iss/apps/option-calc/v1',
            ),
        },
        '/moex-iss': {
          target: 'https://iss.moex.com',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyRes', (response) => {
              delete response.headers['set-cookie']
            })
          },
          rewrite: (path) => path.replace(/^\/moex-iss/, '/iss'),
        },
      },
    },
  }
})
