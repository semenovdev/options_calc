import { expect, test } from '@playwright/test'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`strategy labels remain readable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.evaluate(() => {
      const strategies = ['SLVRUB_TOM', 'IRAO', 'BR', ''].map((assetCode, index) => ({
        id: `rail-${index}`,
        name: `Стратегия ${20 + index}`,
        assetCode,
        assetType: assetCode ? 'share' : null,
        positions: [],
        calculationDate: '',
        volatilityShift: 0,
      }))
      localStorage.setItem(
        'moex-options-workbench:v1',
        JSON.stringify({
          strategies,
          activeId: 'rail-3',
        }),
      )
    })
    await page.reload()
    const items = page.locator('.strategy-item')
    await expect(items).toHaveCount(4)
    for (const item of await items.all()) {
      await item.scrollIntoViewIfNeeded()
      const layout = await item.evaluate((element) => {
        const meta = element.querySelector('.strategy-meta')!
        const title = meta.querySelector('strong')!
        const count = meta.querySelector('small')!
        const code = meta.querySelector('.strategy-code')
        return {
          width: meta.getBoundingClientRect().width,
          titleFits: title.scrollWidth <= title.clientWidth,
          countFits: count.scrollWidth <= count.clientWidth,
          codeFits: !code || code.scrollWidth <= code.clientWidth,
        }
      })
      expect(layout.width).toBeGreaterThan(110)
      expect(layout.titleFits).toBe(true)
      expect(layout.countFits).toBe(true)
      expect(layout.codeFits).toBe(true)
    }
    await expect(items.last().locator('.strategy-code')).toHaveCount(0)
    await page
      .locator('.strategy-rail')
      .screenshot({ path: `/tmp/strategy-rail-${viewport.width}.png` })
  })
}
