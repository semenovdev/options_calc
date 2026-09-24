import { expect, test } from '@playwright/test'

import type { Asset, OptionBoardResponse, OptionSeries } from '../src/types/moex'

const cases = [
  ['GLDRUB_TOM', 'share', 'commodity', 'Металл'],
  ['SLVRUB_TOM', 'share', 'commodity', 'Металл'],
  ['CNYRUB_TOM', 'share', 'currency', 'Валюта'],
  ['SBER', 'share', 'share', 'Акция'],
  ['ROSN', 'share', 'share', 'Акция'],
  ['SMLT', 'share', 'share', 'Акция'],
  ['GOLD', 'futures', 'futures', 'Фьючерс'],
  ['SILV', 'futures', 'futures', 'Фьючерс'],
  ['SI', 'futures', 'futures', 'Фьючерс'],
  ['SBRF', 'futures', 'futures', 'Фьючерс'],
  ['GAZR', 'futures', 'futures', 'Фьючерс'],
  ['RTS', 'futures', 'futures', 'Фьючерс'],
  ['MIX', 'futures', 'futures', 'Фьючерс'],
] as const

for (const [code, assetType, positionType, tab] of cases) {
  test(`${code}: add underlying to a reloaded option strategy @underlying`, async ({ page }) => {
    const prefix = '/moex-option-calc'
    const assetsResponse = await page.request.get(`${prefix}/assets?query=${code.slice(0, 8)}`)
    expect(assetsResponse.ok()).toBe(true)
    const assets: Asset[] = await assetsResponse.json()
    expect(assets.some((a) => a.asset_code === code && a.asset_type === assetType)).toBe(true)
    const response = await page.request.get(
      `${prefix}/assets/${code}/optionseries?asset_type=${assetType}`,
    )
    expect(response.ok()).toBe(true)
    const seriesList: OptionSeries[] = await response.json()
    const current = seriesList
      .filter((s) => s.expiration_date >= new Date().toISOString().slice(0, 10))
      .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date))
    let selected: { series: OptionSeries; secid: string; strike: number; price: number } | undefined
    const diagnostics: string[] = []
    for (const series of current.slice(0, 3)) {
      const boardResponse = await page.request.get(
        `${prefix}/assets/${code}/optionseries/${series.optionseries_code}/optionboard?asset_type=${assetType}`,
      )
      if (!boardResponse.ok()) {
        diagnostics.push(`${series.optionseries_code}: ${await boardResponse.text()}`)
        continue
      }
      const board: OptionBoardResponse = await boardResponse.json()
      const rows = board.call
        .filter(
          (row) =>
            Number.isFinite(row.volatility) &&
            row.volatility! > 0 &&
            Number.isFinite(row.theorprice) &&
            row.theorprice! > 0,
        )
        .sort(
          (a, b) =>
            Math.abs(a.strike - series.central_strike!) -
            Math.abs(b.strike - series.central_strike!),
        )
      if (rows[0]) {
        selected = {
          series,
          secid: rows[0].secid,
          strike: rows[0].strike,
          price: rows[0].theorprice!,
        }
        break
      }
    }
    expect(selected, `No live priced option for ${code}: ${diagnostics.join('; ')}`).toBeDefined()
    const { series, secid, strike, price } = selected!
    // Restore a real option position; every catalogue, quote and calculation request stays live.
    await page.goto('/')
    await page.evaluate(
      ({ code, assetType, series, secid, strike, price }) => {
        localStorage.setItem(
          'moex-options-workbench:v1',
          JSON.stringify({
            activeId: 'underlying-e2e',
            strategies: [
              {
                id: 'underlying-e2e',
                name: 'Underlying regression',
                assetCode: code,
                assetType,
                calculationDate: '',
                volatilityShift: 0,
                positions: [
                  {
                    id: 'option',
                    secid,
                    type: 'option',
                    quantity: 1,
                    price,
                    nettedIm: true,
                    strike,
                    optionType: 'call',
                    expirationDate: series.expiration_date,
                    optionSeriesCode: series.optionseries_code,
                    underlyingFutureCode: series.futures_code,
                  },
                ],
              },
            ],
          }),
        )
      },
      { code, assetType, series, secid, strike, price },
    )
    await page.reload()
    await expect(page.locator('.positions-table tbody tr')).toHaveCount(1)
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Добавить инструмент' })
    await expect(dialog.getByRole('button', { name: tab, exact: true })).toBeEnabled({
      timeout: 20000,
    })
    await dialog.getByRole('button', { name: tab, exact: true }).click()
    const underlyingSecid = assetType === 'futures' ? series.futures_code! : code
    if (assetType === 'futures') {
      await expect(dialog.locator('.futures-list button')).toHaveCount(1, { timeout: 20000 })
      await dialog.locator('.futures-list button').filter({ hasText: underlyingSecid }).click()
    }
    await expect(dialog.getByRole('button', { name: 'Добавить позицию' })).toBeEnabled({
      timeout: 30000,
    })
    await dialog.getByRole('button', { name: 'Добавить позицию' }).click()
    const calculation = page.waitForResponse(
      (r) =>
        r.url().endsWith('/portfolio/') &&
        r
          .request()
          .postDataJSON()
          ?.positions?.some(
            (p: { secid: string; type: string }) =>
              p.secid === underlyingSecid && p.type === positionType,
          ),
      { timeout: 40000 },
    )
    await dialog.getByRole('button', { name: 'Готово' }).click()
    const calculated = await calculation
    expect(calculated.status(), await calculated.text()).toBe(200)
    expect(calculated.request().postDataJSON()).toMatchObject({
      asset_code: code,
      asset_type: assetType,
    })
    await expect(page.locator('.positions-table tbody tr')).toHaveCount(2)
    await expect(page.locator('.pnl-value')).not.toHaveText(/^[-—]$/, { timeout: 30000 })
  })
}
