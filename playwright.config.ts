import { defineConfig, devices } from '@playwright/test'

const backend = process.env.E2E_BACKEND ?? 'moex'
const backendDirectory =
  process.env.E2E_RUST_BACKEND_DIR ?? '/Users/s.semenov/GolandProjects/options_calc_backend'
const rust = backend === 'rust'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    ...(rust
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
      command: 'npm run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: rust ? { VITE_OPTION_CALC_PROXY_TARGET: 'http://127.0.0.1:8080' } : undefined,
    },
  ],
})
