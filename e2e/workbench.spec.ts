import { expect, test, type Page, type Request } from '@playwright/test'

import { discoverLiveCase, type LiveCase } from './liveApi'
import { MOEX_OPTION_UNDERLYINGS } from './fixtures/moexUnderlyings'

interface ObservedApi {
  portfolioRequests: Record<string, unknown>[]
  graphRequests: string[]
  issRequests: string[]
}

function observeApi(page: Page): ObservedApi {
  const observed: ObservedApi = { portfolioRequests: [], graphRequests: [], issRequests: [] }
  page.on('request', (request: Request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/moex-iss/')) observed.issRequests.push(url.pathname)
    if (request.method() === 'POST' && url.pathname.endsWith('/portfolio/')) {
      observed.portfolioRequests.push(request.postDataJSON() as Record<string, unknown>)
    }
    const graph = url.pathname.match(/\/portfolio\/graph\/([^/]+)$/)?.[1]
    if (graph) observed.graphRequests.push(graph)
  })
  return observed
}

async function waitForPersistedPositions(page: Page, count: number): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(localStorage.getItem('moex-options-workbench:v1') ?? '{}') as {
          strategies?: { positions?: unknown[] }[]
        }
        return Math.max(...(stored.strategies ?? []).map((item) => item.positions?.length ?? 0), 0)
      }),
    )
    .toBe(count)
}

async function addTheoreticalStrangle(page: Page, live: LiveCase): Promise<void> {
  await page.getByRole('button', { name: 'Добавить инструмент' }).click()
  const dialog = page.getByRole('dialog', { name: 'Добавить инструмент' })
  await dialog
    .getByPlaceholder('Тикер или название, например SBER или Si')
    .fill(live.asset.asset_code)
  await dialog
    .locator('.result-code')
    .getByText(live.asset.asset_code, { exact: true })
    .last()
    .click()

  await expect(dialog.getByLabel('Экспирация')).toBeVisible()
  await dialog.getByLabel('Экспирация').selectOption(live.series.optionseries_code)
  await dialog.getByRole('button', { name: 'Расчётная' }).click()
  await dialog.getByPlaceholder('Страйк или SECID').fill(live.call.secid)
  await dialog.getByText(live.call.secid, { exact: true }).click()
  await expect(dialog.getByLabel('Цена входа')).toHaveValue(String(live.call.theorprice))
  await dialog.getByRole('button', { name: 'Добавить позицию' }).click()

  await dialog.getByRole('button', { name: /^Put/ }).click()
  await dialog.getByPlaceholder('Страйк или SECID').fill(live.put.secid)
  await dialog.getByText(live.put.secid, { exact: true }).click()
  await expect(dialog.getByLabel('Цена входа')).toHaveValue(String(live.put.theorprice))
  await dialog.getByRole('button', { name: 'Добавить позицию' }).click()
  await expect(dialog.getByText('В наборе: 2')).toBeVisible()
  await dialog.getByRole('button', { name: 'Готово' }).click()

  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('.positions-table tbody tr')).toHaveCount(2)
  await expect(page.getByText(live.call.secid, { exact: true })).toBeVisible()
  await expect(page.getByText(live.put.secid, { exact: true })).toBeVisible()
  await waitForPersistedPositions(page, 2)
}

function lastPositions(observed: ObservedApi) {
  const payload = observed.portfolioRequests.at(-1) as { positions?: Record<string, unknown>[] }
  return payload?.positions ?? []
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-storage-initialized')) return
    localStorage.clear()
    sessionStorage.setItem('e2e-storage-initialized', 'true')
  })
})

test('empty strategy → select asset and series → add call and put at theoretical prices', async ({
  page,
}) => {
  const observed = observeApi(page)
  await page.goto('/')
  const live = await discoverLiveCase(page)
  await addTheoreticalStrangle(page, live)

  await expect.poll(() => lastPositions(observed).length).toBe(2)
  expect(lastPositions(observed)).toEqual([
    expect.objectContaining({ secid: live.call.secid, price: live.call.theorprice, quantity: 1 }),
    expect.objectContaining({ secid: live.put.secid, price: live.put.theorprice, quantity: 1 }),
  ])
  await expect(page.locator('.pnl-value')).not.toHaveText('—', { timeout: 45_000 })
  if (process.env.E2E_BACKEND === 'rust') expect(observed.issRequests).toEqual([])
})

test('editing quantity and price recalculates after blur', async ({ page }) => {
  const observed = observeApi(page)
  await page.goto('/')
  const live = await discoverLiveCase(page)
  await addTheoreticalStrangle(page, live)

  const firstRow = page.locator('.positions-table tbody tr').filter({ hasText: live.call.secid })
  await firstRow.locator('input.quantity').fill('3')
  await firstRow.locator('input.quantity').blur()
  await expect.poll(() => lastPositions(observed)[0]?.quantity).toBe(3)

  const editedPrice = Number(live.call.theorprice) + 1
  await firstRow.locator('input.price').fill(String(editedPrice))
  await firstRow.locator('input.price').blur()
  await expect.poll(() => lastPositions(observed)[0]?.price).toBe(editedPrice)
})

test('reload and switching back to a populated strategy trigger recalculation', async ({
  page,
}) => {
  const observed = observeApi(page)
  await page.goto('/')
  const live = await discoverLiveCase(page)
  await addTheoreticalStrangle(page, live)

  const beforeReload = observed.portfolioRequests.length
  await page.reload()
  await expect(page.locator('.positions-table tbody tr')).toHaveCount(2)
  await expect.poll(() => observed.portfolioRequests.length).toBeGreaterThan(beforeReload)
  await expect(page.getByRole('button', { name: 'Пересчитать' })).toBeEnabled({ timeout: 45_000 })

  await page.getByTitle('Новая стратегия').click()
  await expect(page.getByRole('button', { name: 'Добавить инструмент' })).toBeEnabled()
  const beforeSwitch = observed.portfolioRequests.length
  await page.locator('.strategy-item').filter({ hasText: live.asset.asset_code }).first().click()
  await expect(page.locator('.positions-table tbody tr')).toHaveCount(2)
  await expect.poll(() => observed.portfolioRequests.length).toBeGreaterThan(beforeSwitch)
})

test('adding another position is locked to the selected underlying', async ({ page }) => {
  await page.goto('/')
  const live = await discoverLiveCase(page)
  await addTheoreticalStrangle(page, live)

  await page.locator('.positions-section').getByRole('button', { name: 'Добавить' }).click()
  const dialog = page.getByRole('dialog', { name: 'Добавить инструмент' })
  await expect(dialog.getByRole('heading', { name: live.asset.title })).toBeVisible()
  await expect(dialog.getByPlaceholder('Тикер или название, например SBER или Si')).toHaveCount(0)
  await expect(dialog.getByLabel('Экспирация')).toHaveValue(live.series.optionseries_code)
})

test('renders volatility smile and every P&L/Greeks graph', async ({ page }) => {
  const observed = observeApi(page)
  await page.goto('/')
  const live = await discoverLiveCase(page)
  await addTheoreticalStrangle(page, live)

  await page.getByRole('button', { name: 'Улыбка IV' }).click()
  await expect(page.getByTestId('smile-chart').locator('canvas')).toBeVisible()

  await page.getByRole('button', { name: 'Профиль' }).click()
  for (const indicator of ['P&L', 'Delta', 'Gamma', 'Vega', 'Theta', 'Rho']) {
    await page.locator('.indicator-switcher').getByRole('button', { name: indicator }).click()
    await expect(page.getByTestId('profile-chart').locator('canvas')).toBeVisible()
  }
  expect(new Set(observed.graphRequests)).toEqual(
    new Set(['profit_and_loss', 'delta', 'gamma', 'vega', 'theta', 'rho']),
  )
})

test('@catalog snapshotted MOEX option underlyings are searchable through the target', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Добавить инструмент' }).click()
  const dialog = page.getByRole('dialog', { name: 'Добавить инструмент' })
  const search = dialog.getByPlaceholder('Тикер или название, например SBER или Si')
  const missingInSearch: string[] = []
  for (const [assetCode, assetType] of MOEX_OPTION_UNDERLYINGS) {
    await search.fill(assetCode)
    await page.waitForTimeout(300)
    await expect(dialog.locator('.spinning')).toHaveCount(0, { timeout: 5_000 })
    const found = dialog
      .locator('.result-code')
      .getByText(assetCode, { exact: true })
      .locator('..')
      .filter({ hasText: assetType })
    if ((await found.count()) === 0) {
      missingInSearch.push(`${assetType}:${assetCode}`)
    }
  }

  expect(missingInSearch, `Underlyings absent in UI search: ${missingInSearch.join(', ')}`).toEqual(
    [],
  )
})
