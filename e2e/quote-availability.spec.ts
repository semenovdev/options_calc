import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`missing quotes are a warning and recover after refresh at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(() => {
      localStorage.setItem(
        'moex-options-workbench:v1',
        JSON.stringify({
          activeId: 'silver',
          strategies: [
            {
              id: 'silver',
              name: 'Серебро',
              assetCode: 'SLVRUB_TOM',
              assetType: 'share',
              calculationDate: '',
              volatilityShift: 0,
              positions: [
                {
                  id: 'put',
                  secid: 'S2170CX6',
                  type: 'option',
                  quantity: -1,
                  price: 8.34,
                  nettedIm: true,
                  expirationDate: '2099-12-17',
                  strike: 170,
                  optionType: 'put',
                },
              ],
            },
          ],
        }),
      )
    })
    let state: 'missing' | 'ready' | 'partial' | 'invalid' = 'missing'
    const applicationErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('[MOEX Options]'))
        applicationErrors.push(message.text())
    })
    await page.route('**/moex-option-calc/portfolio/**', async (route) => {
      if (state === 'missing' || state === 'invalid') {
        await route.fulfill({
          status: 503,
          json: {
            code: 'LIVE_DATA_UNAVAILABLE',
            retryable: true,
            details: {},
            message:
              state === 'missing'
                ? 'Neither market nor settlement valuation context is complete: market: missing market price for S2170CX6; settlement: missing settlement price for SLVRUB_TOM'
                : 'Neither market nor settlement valuation context is complete: market: IV_PRICE_BOUNDS; settlement: missing settlement price for SLVRUB_TOM',
          },
        })
        return
      }
      const valuation_context = {
        mode: 'market',
        underlying_secid: 'SLVRUB_TOM',
        underlying_price: 171.25,
      }
      const points = [
        { underlying_price: 128, value: -33.66 },
        { underlying_price: 150, value: -11.66 },
        { underlying_price: 170, value: 8.34 },
        { underlying_price: 171.25, value: 8.34 },
        { underlying_price: 214, value: 8.34 },
      ]
      const warnings =
        state === 'partial'
          ? [{ code: 'MODEL_DATA_UNAVAILABLE', secid: 'S2170CX6', message: 'IV_PRICE_BOUNDS' }]
          : undefined
      await route.fulfill({
        json: route.request().url().includes('/graph/')
          ? {
              now: state === 'partial' ? [] : points,
              on_expiration: points,
              valuation_context,
              warnings,
            }
          : {
              positions: [],
              total: {
                profit_and_loss_rub: state === 'partial' ? -119.1 : 2,
                delta: state === 'partial' ? null : 0.5,
              },
              initial_margin: null,
              valuation_context,
              warnings,
            },
      })
    })
    await page.goto('/')
    await expect(page.locator('.warning-banner')).toContainText('недостаточно котировок')
    await expect(page.locator('.error-banner')).toHaveCount(0)
    await expect(page.locator('.availability-warning')).toContainText('График пока недоступен')
    await expect(page.locator('.pnl-value')).toHaveText('—')
    await expect(page.locator('.positions-table .quantity')).toBeEnabled()
    expect(applicationErrors).toEqual([])
    const bannerFits = await page
      .locator('.warning-banner')
      .evaluate((element) => element.scrollWidth <= element.clientWidth)
    expect(bannerFits).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('quote-warning.png'), fullPage: true })
    state = 'ready'
    await page.getByRole('button', { name: 'Пересчитать', exact: true }).click()
    await expect(page.locator('.warning-banner')).toHaveCount(0)
    await expect(page.locator('.pnl-value')).not.toHaveText('—')
    await expect(page.getByTestId('profile-chart')).toBeVisible()
    state = 'partial'
    await page.getByRole('button', { name: 'Пересчитать', exact: true }).click()
    await expect(page.locator('.warning-banner').first()).toContainText('P&L рассчитан')
    await expect(page.locator('.error-banner')).toHaveCount(0)
    await expect(page.locator('.pnl-value')).toContainText('-119,1')
    await expect(page.getByTestId('profile-chart')).toBeVisible()
    await expect(page.locator('.greeks-grid strong').first()).toHaveText('—')
    expect(applicationErrors).toEqual([])
    await expect
      .poll(async () =>
        page
          .getByTestId('profile-chart')
          .locator('canvas')
          .first()
          .evaluate((canvas) => {
            const ctx = (canvas as HTMLCanvasElement).getContext('2d')!
            const { width, height } = ctx.canvas
            const pixels = ctx.getImageData(
              0,
              Math.floor(height * 0.25),
              width,
              Math.floor(height * 0.65),
            ).data
            let count = 0
            for (let i = 0; i < pixels.length; i += 4) {
              if (
                pixels[i]! > 70 &&
                pixels[i]! < 125 &&
                pixels[i + 1]! > 115 &&
                pixels[i + 1]! < 175 &&
                pixels[i + 2]! > 215
              )
                count++
            }
            return count
          }),
      )
      .toBeGreaterThan(60)
    await page.screenshot({
      path: testInfo.outputPath('partial-model-warning.png'),
      fullPage: true,
    })
    state = 'ready'
    await page.getByRole('button', { name: 'Пересчитать', exact: true }).click()
    await expect(page.locator('.warning-banner')).toHaveCount(0)
    state = 'invalid'
    await page.getByRole('button', { name: 'Пересчитать', exact: true }).click()
    await expect(page.locator('.error-banner')).toContainText('IV_PRICE_BOUNDS')
    await expect(page.locator('.warning-banner')).toHaveCount(0)
  })
}
