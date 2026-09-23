import { expect, test, type Page, type Request, type Response } from '@playwright/test'

import { discoverLiveCase, type LiveCase } from './liveApi'
import { MOEX_OPTION_UNDERLYINGS } from './fixtures/moexUnderlyings'

interface ObservedApi {
  portfolioRequests: Record<string, unknown>[]
  graphRequests: string[]
  issRequests: string[]
  boardRequests: string[]
  smileRequests: string[]
  seriesRequests: string[]
  successfulPaths: string[]
  graphResponses: Map<string, Promise<{ status: number; body: unknown }>>
}

function observeApi(page: Page): ObservedApi {
  const observed: ObservedApi = {
    portfolioRequests: [],
    graphRequests: [],
    issRequests: [],
    boardRequests: [],
    smileRequests: [],
    seriesRequests: [],
    successfulPaths: [],
    graphResponses: new Map(),
  }
  page.on('request', (request: Request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/moex-iss/')) observed.issRequests.push(url.pathname)
    if (url.pathname.endsWith('/optionboard')) observed.boardRequests.push(url.pathname)
    if (url.pathname.endsWith('/volatility_graph')) observed.smileRequests.push(url.pathname)
    if (url.pathname.endsWith('/optionseries')) observed.seriesRequests.push(url.pathname)
    if (request.method() === 'POST' && url.pathname.endsWith('/portfolio/')) {
      observed.portfolioRequests.push(request.postDataJSON() as Record<string, unknown>)
    }
    const graph = url.pathname.match(/\/portfolio\/graph\/([^/]+)$/)?.[1]
    if (graph) observed.graphRequests.push(graph)
  })
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (response.ok()) observed.successfulPaths.push(path)
    const indicator = path.match(/\/portfolio\/graph\/([^/]+)$/)?.[1]
    if (indicator)
      observed.graphResponses.set(
        indicator,
        response.json().then(
          (body: unknown) => ({ status: response.status(), body }),
          (error: unknown) => ({ status: response.status(), body: String(error) }),
        ),
      )
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

async function addTheoreticalStrangle(
  page: Page,
  live: LiveCase,
  beforeDone?: () => void,
): Promise<{ callPrice: number; putPrice: number }> {
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
  await dialog.getByRole('button', { name: 'Расчётная', exact: true }).click()
  await dialog.getByPlaceholder('Страйк или SECID').fill(live.call.secid)
  await dialog.getByText(live.call.secid, { exact: true }).click()
  const callPrice = Number(await dialog.getByLabel('Цена входа').inputValue())
  expect(Number.isFinite(callPrice)).toBe(true)
  expect(callPrice).toBeGreaterThanOrEqual(0)
  await expect(dialog.getByLabel('Цена входа')).not.toHaveValue('')
  await expect(dialog.locator('.option-list button.selected .quote-value strong')).toHaveText(
    new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(callPrice),
  )
  await dialog.getByRole('button', { name: 'Добавить позицию' }).click()

  await dialog.getByRole('button', { name: /^Put/ }).click()
  await dialog.getByPlaceholder('Страйк или SECID').fill(live.put.secid)
  await dialog.getByText(live.put.secid, { exact: true }).click()
  const putPrice = Number(await dialog.getByLabel('Цена входа').inputValue())
  expect(Number.isFinite(putPrice)).toBe(true)
  expect(putPrice).toBeGreaterThanOrEqual(0)
  await expect(dialog.getByLabel('Цена входа')).not.toHaveValue('')
  await expect(dialog.locator('.option-list button.selected .quote-value strong')).toHaveText(
    new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(putPrice),
  )
  await dialog.getByRole('button', { name: 'Добавить позицию' }).click()
  await expect(dialog.getByText('В наборе: 2')).toBeVisible()
  beforeDone?.()
  await dialog.getByRole('button', { name: 'Готово' }).click()

  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('.positions-table tbody tr')).toHaveCount(2)
  await expect(page.getByText(live.call.secid, { exact: true })).toBeVisible()
  await expect(page.getByText(live.put.secid, { exact: true })).toBeVisible()
  await waitForPersistedPositions(page, 2)
  return { callPrice, putPrice }
}

function lastPositions(observed: ObservedApi) {
  const payload = observed.portfolioRequests.at(-1) as { positions?: Record<string, unknown>[] }
  return payload?.positions ?? []
}

async function expectSmile(page: Page, response: Response): Promise<void> {
  const text = await response.text()
  expect.soft(response.status(), `IV smile: ${response.url()}\n${text}`).toBe(200)
  // Keep the failed assertion, but do not wait for a canvas the failed request cannot produce.
  if (response.status() !== 200) return

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  expect.soft(Array.isArray(body), `IV smile must be an array: ${text}`).toBe(true)
  if (Array.isArray(body)) {
    expect.soft(body.length).toBeGreaterThanOrEqual(2)
    for (const [index, point] of body.entries()) {
      expect
        .soft(point, `IV smile point ${index}`)
        .toEqual(
          expect.objectContaining({ strike: expect.any(Number), volatility: expect.any(Number) }),
        )
      if (typeof point?.strike !== 'number' || typeof point?.volatility !== 'number') continue
      expect.soft(Number.isFinite(point.strike)).toBe(true)
      expect.soft(Number.isFinite(point.volatility)).toBe(true)
      expect.soft(point.volatility).toBeGreaterThan(0)
      if (index && typeof body[index - 1]?.strike === 'number') {
        expect.soft(point.strike).toBeGreaterThan(body[index - 1].strike)
      }
    }
  }
  await expect
    .soft(page.getByTestId('smile-chart').locator('canvas'))
    .toBeVisible({ timeout: 45_000 })
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
  const prices = await addTheoreticalStrangle(page, live)

  await expect.poll(() => lastPositions(observed).length).toBe(2)
  expect(lastPositions(observed)).toEqual([
    expect.objectContaining({ secid: live.call.secid, price: prices.callPrice, quantity: 1 }),
    expect.objectContaining({ secid: live.put.secid, price: prices.putPrice, quantity: 1 }),
  ])
  await expect(page.locator('.pnl-value')).not.toHaveText('—', { timeout: 45_000 })
  if (process.env.E2E_BACKEND === 'rust') expect(observed.issRequests).toEqual([])
})

test('editing quantity and price recalculates after blur', async ({ page }) => {
  const observed = observeApi(page)
  await page.goto('/')
  const live = await discoverLiveCase(page)
  const prices = await addTheoreticalStrangle(page, live)

  const firstRow = page.locator('.positions-table tbody tr').filter({ hasText: live.call.secid })
  await firstRow.locator('input.quantity').fill('3')
  await firstRow.locator('input.quantity').blur()
  await expect.poll(() => lastPositions(observed)[0]?.quantity).toBe(3)

  const editedPrice = prices.callPrice + 1
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

  const smileResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith('/volatility_graph'),
    { timeout: 45_000 },
  )
  await page.getByRole('button', { name: 'Улыбка IV' }).click()
  await expectSmile(page, await smileResponse)

  await page.getByRole('button', { name: 'Профиль' }).click()
  for (const [label, indicator] of [
    ['P&L', 'profit_and_loss'],
    ['Delta', 'delta'],
    ['Gamma', 'gamma'],
    ['Vega', 'vega'],
    ['Theta', 'theta'],
    ['Rho', 'rho'],
  ] as const) {
    await page
      .locator('.indicator-switcher')
      .getByRole('button', { name: label, exact: true })
      .click()
    await expect.poll(() => observed.graphResponses.has(indicator), { timeout: 45_000 }).toBe(true)
    const response = await observed.graphResponses.get(indicator)!
    expect(response.status, `${indicator}: ${JSON.stringify(response.body)}`).toBe(200)
    const graph = response.body as Record<string, { underlying_price: number; value: number }[]>
    for (const name of ['now', 'on_expiration']) {
      expect(Array.isArray(graph[name]), `${indicator}.${name}`).toBe(true)
      expect(graph[name]!.length).toBeGreaterThan(0)
      for (const point of graph[name]!) {
        expect(Number.isFinite(point.underlying_price), `${indicator}.${name} underlying`).toBe(
          true,
        )
        expect(Number.isFinite(point.value), `${indicator}.${name} value`).toBe(true)
      }
    }
    await expect(page.getByTestId('profile-chart').locator('canvas')).toBeVisible({
      timeout: 45_000,
    })
  }
  expect(new Set(observed.graphRequests)).toEqual(
    new Set(['profit_and_loss', 'delta', 'gamma', 'vega', 'theta', 'rho']),
  )
})

test('profile requests only the selected graph; smile and liquidity load on demand', async ({
  page,
}) => {
  const observed = observeApi(page)
  await page.goto('/')
  const live = await discoverLiveCase(page)
  const successful = (suffix: string) =>
    observed.successfulPaths.filter((path) => path.endsWith(suffix)).length
  let beforeDone = { boards: 0, series: 0, smiles: 0, successfulBoards: 0 }
  await addTheoreticalStrangle(page, live, () => {
    beforeDone = {
      boards: observed.boardRequests.length,
      series: observed.seriesRequests.length,
      smiles: observed.smileRequests.length,
      successfulBoards: successful('/optionboard'),
    }
  })
  await expect(page.locator('.pnl-value')).not.toHaveText('—', { timeout: 45_000 })
  await expect(page.getByTestId('profile-chart').locator('canvas')).toBeVisible({ timeout: 45_000 })
  // Observe the completed request burst, including work accidentally scheduled after rendering.
  await page.waitForLoadState('networkidle', { timeout: 45_000 })
  expect([...new Set(observed.graphRequests)]).toEqual(['profit_and_loss'])
  expect(successful('/portfolio/')).toBe(1)
  expect(successful('/portfolio/graph/profit_and_loss')).toBe(1)
  expect(observed.smileRequests).toHaveLength(beforeDone.smiles)
  expect(observed.seriesRequests).toHaveLength(beforeDone.series)
  const profileBoardCount = observed.boardRequests.length - beforeDone.boards
  if (process.env.E2E_BACKEND === 'rust') {
    expect(observed.graphRequests).toHaveLength(1)
    expect(observed.portfolioRequests).toHaveLength(1)
    expect(profileBoardCount).toBe(0)
    expect(observed.issRequests).toEqual([])
  } else {
    // Legacy portfolio responses have no valuation_context and still use the board/ISS path.
    // Count successful reads separately from the permitted legacy retry attempts.
    expect(successful('/optionboard') - beforeDone.successfulBoards).toBeLessThanOrEqual(1)
    expect(profileBoardCount).toBeLessThanOrEqual(3)
    expect(observed.graphRequests.length).toBeLessThanOrEqual(3)
    expect(observed.portfolioRequests.length).toBeLessThanOrEqual(3)
  }

  const boardsBeforeSmile = observed.boardRequests.length
  const successfulBoardsBeforeSmile = successful('/optionboard')
  const successfulSmilesBefore = successful('/volatility_graph')
  const smileResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith('/volatility_graph'),
    { timeout: 45_000 },
  )
  await page.getByRole('button', { name: 'Улыбка IV' }).click()
  const smile = await smileResponse
  await expectSmile(page, smile)
  if (smile.status() === 200) {
    expect(successful('/volatility_graph') - successfulSmilesBefore).toBe(1)
  }
  const smileRequestsBeforeLiquidity = observed.smileRequests.length
  expect(observed.boardRequests).toHaveLength(boardsBeforeSmile)
  await page.getByRole('button', { name: 'Ликвидность', exact: true }).click()
  await expect(page.locator('.liquidity-table')).toBeVisible({ timeout: 45_000 })
  expect(successful('/optionboard') - successfulBoardsBeforeSmile).toBe(1)
  expect(observed.smileRequests).toHaveLength(smileRequestsBeforeLiquidity)
  if (smile.status() === 200) {
    expect(successful('/volatility_graph') - successfulSmilesBefore).toBe(1)
  }
  expect([...new Set(observed.graphRequests)]).toEqual(['profit_and_loss'])
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
    const searchResponse = page.waitForResponse(
      (response) => {
        const url = new URL(response.url())
        return url.pathname.endsWith('/assets') && url.searchParams.get('query') === assetCode
      },
      { timeout: 45_000 },
    )
    await search.fill(assetCode)
    const response = await searchResponse
    let diagnostic = `${assetCode}: HTTP ${response.status()} ${response.url()}`
    if (!response.ok()) {
      const body = await response.text()
      diagnostic += `\n${body}`
      await test.info().attach(`failed-search-${assetCode}`, {
        body: diagnostic,
        contentType: 'text/plain',
      })
    }
    expect(response.ok(), diagnostic).toBe(true)
    await expect(dialog.locator('.spinning')).toHaveCount(0, { timeout: 45_000 })
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
