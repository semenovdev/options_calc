import { defineConfig, devices } from '@playwright/test'

const backend = process.env.E2E_BACKEND ?? 'moex'
if (backend !== 'moex' && backend !== 'rust') throw new Error(`Unknown E2E_BACKEND: ${backend}`)
const backendDirectory =
  process.env.E2E_RUST_BACKEND_DIR ?? '/Users/s.semenov/GolandProjects/options_calc_backend'
const rust = backend === 'rust'
const externalRustUrl = process.env.E2E_RUST_API_URL?.replace(/\/+$/, '')
const rustUrl = externalRustUrl ?? 'http://127.0.0.1:8080'
const apiTarget = rust ? rustUrl : 'https://iss.moex.com/iss/apps/option-calc/v1'
const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 4173)
if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65535) {
  throw new Error('E2E_FRONTEND_PORT must be an integer between 1 and 65535')
}
const frontendUrl = `http://127.0.0.1:${frontendPort}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  metadata: { backend, apiTarget },
  use: {
    baseURL: frontendUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    ...(rust && !externalRustUrl
      ? [
          {
            command: 'cargo run --locked -p option-calc -- --config examples/config.toml',
            cwd: backendDirectory,
            url: 'http://127.0.0.1:8080/health/ready',
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
        ]
      : []),
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      url: frontendUrl,
      // A previous Vite process may proxy to a different backend.
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_OPTION_CALC_BASE_URL: '/moex-option-calc',
        VITE_OPTION_CALC_PROXY_TARGET: apiTarget,
        VITE_AUTO_REFRESH_INTERVAL_MS: '3600000',
      },
    },
  ],
})
