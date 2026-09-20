import {
  expect,
  request as playwrightRequest,
  test,
  type Page,
  type Request,
} from '@playwright/test'

import {
  BACKEND_MODE,
  discoverLiveCase,
  optionBoard,
  optionSecids,
  REFERENCE_API,
  referenceCatalog,
  targetCatalog,
  TARGET_API_PREFIX,
  type LiveCase,
} from './liveApi'

interface ObservedApi {
  portfolioRequests: Record<string, unknown>[]
  graphRequests: string[]
}

function observeApi(page: Page): ObservedApi {
  const observed: ObservedApi = { portfolioRequests: [], graphRequests: [] }
  page.on('request', (request: Request) => {
    const url = new URL(request.url())
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
  await expect(page.locator('.pnl-value')).not.toHaveText('—')
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

  await page.getByTitle('Новая стратегия').click()
  await expect(page.getByRole('button', { name: 'Добавить инструмент' })).toBeEnabled()
  const beforeSwitch = observed.portfolioRequests.length
  await page.locator('.strategy-item').filter({ hasText: live.asset.asset_code }).first().click()
  await expect(page.locator('.positions-table tbody tr')).toHaveCount(2)
  await expect.poll(() => observed.portfolioRequests.length).toBeGreaterThan(beforeSwitch)
})

test('cached strategy remains usable when network APIs become unavailable', async ({ page }) => {
  await page.goto('/')
  const live = await discoverLiveCase(page)
  await addTheoreticalStrangle(page, live)

  await page.route('**/moex-option-calc/**', (route) => route.abort('connectionfailed'))
  await page.route('**/moex-iss/**', (route) => route.abort('connectionfailed'))
  await page.reload()

  await expect(page.locator('.positions-table tbody tr')).toHaveCount(2)
  await expect(page.locator('.positions-table input.quantity').first()).toBeEnabled()
  await expect(page.getByRole('alert')).toContainText('Не удалось подключиться к MOEX')
  await page.getByRole('button', { name: 'Улыбка IV' }).click()
  await expect(page.locator('.inline-error')).toContainText('Не удалось подключиться к MOEX')
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

test('@catalog all MOEX underlyings and options are searchable and exposed by the target', async ({
  page,
}) => {
  test.setTimeout(1_200_000)
  await page.goto('/')
  const reference = await referenceCatalog()
  const target = await targetCatalog(page)
  const targetKeys = new Set(
    target.map((entry) => `${entry.asset.asset_type}:${entry.asset.asset_code}`),
  )
  const missingAssets = reference
    .map((entry) => `${entry.asset.asset_type}:${entry.asset.asset_code}`)
    .filter((key) => !targetKeys.has(key))

  await page.getByRole('button', { name: 'Добавить инструмент' }).click()
  const dialog = page.getByRole('dialog', { name: 'Добавить инструмент' })
  const search = dialog.getByPlaceholder('Тикер или название, например SBER или Si')
  const missingInSearch: string[] = []
  for (const entry of reference) {
    await search.fill(entry.asset.asset_code)
    await page.waitForTimeout(400)
    const found = dialog.locator('.result-code').getByText(entry.asset.asset_code, { exact: true })
    if ((await found.count()) === 0)
      missingInSearch.push(`${entry.asset.asset_type}:${entry.asset.asset_code}`)
  }

  const referenceRequest = await playwrightRequest.newContext()
  const missingOptions: string[] = []
  const missingOptionsInSearch: string[] = []
  try {
    for (const referenceEntry of reference) {
      const targetEntry = target.find(
        (entry) =>
          entry.asset.asset_code === referenceEntry.asset.asset_code &&
          entry.asset.asset_type === referenceEntry.asset.asset_type,
      )
      if (!targetEntry) continue
      const referenceSecids = await optionSecids(referenceRequest, REFERENCE_API, referenceEntry)
      const targetSecids =
        BACKEND_MODE === 'moex'
          ? referenceSecids
          : await optionSecids(page.request, TARGET_API_PREFIX, targetEntry)
      for (const [seriesCode, secids] of referenceSecids) {
        const available = new Set(targetSecids.get(seriesCode) ?? [])
        secids
          .filter((secid) => !available.has(secid))
          .forEach((secid) => missingOptions.push(`${seriesCode}:${secid}`))
      }

      await search.fill(referenceEntry.asset.asset_code)
      await page.waitForTimeout(400)
      await dialog
        .locator('.asset-results button')
        .filter({
          has: dialog
            .locator('.result-code')
            .getByText(referenceEntry.asset.asset_code, { exact: true }),
        })
        .last()
        .click()
      await expect(dialog.getByLabel('Экспирация')).toBeVisible()
      await dialog.getByRole('button', { name: 'Расчётная' }).click()
      for (const series of targetEntry.series) {
        const referenceSeries = referenceEntry.series.find(
          (candidate) => candidate.optionseries_code === series.optionseries_code,
        )
        if (!referenceSeries) continue
        await dialog.getByLabel('Экспирация').selectOption(series.optionseries_code)
        const board = await optionBoard(
          referenceRequest,
          REFERENCE_API,
          referenceEntry,
          referenceSeries,
        )
        for (const [kind, rows] of [
          ['Call', board.call],
          ['Put', board.put],
        ] as const) {
          await dialog.getByRole('button', { name: new RegExp(`^${kind}`) }).click()
          for (const row of rows) {
            await dialog.getByPlaceholder('Страйк или SECID').fill(row.secid)
            if ((await dialog.getByText(row.secid, { exact: true }).count()) === 0) {
              missingOptionsInSearch.push(`${series.optionseries_code}:${row.secid}`)
            }
          }
        }
      }
      await dialog.getByRole('button', { name: 'Назад' }).click()
    }
  } finally {
    await referenceRequest.dispose()
  }

  expect(missingAssets, `Missing option underlyings: ${missingAssets.join(', ')}`).toEqual([])
  expect(missingInSearch, `Underlyings absent in UI search: ${missingInSearch.join(', ')}`).toEqual(
    [],
  )
  expect(
    missingOptions,
    `Option SECIDs absent from target: ${missingOptions.slice(0, 50).join(', ')}`,
  ).toEqual([])
  expect(
    missingOptionsInSearch,
    `Option SECIDs absent from UI search: ${missingOptionsInSearch.slice(0, 50).join(', ')}`,
  ).toEqual([])
})
