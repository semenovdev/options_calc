import { expect, test } from '@playwright/test'

test('expired option is visible, read-only, and blocks portfolio requests until removal', async ({
  page,
}) => {
  const portfolioRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/portfolio/')) {
      portfolioRequests.push(request.url())
    }
  })
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem(
      'moex-options-workbench:v1',
      JSON.stringify({
        activeId: 'expired-strategy',
        strategies: [
          {
            id: 'expired-strategy',
            name: 'Истекшая стратегия',
            assetCode: 'SMLT',
            assetType: 'share',
            calculationDate: '',
            volatilityShift: 0,
            positions: [
              {
                id: 'old-option',
                secid: 'SS150CI6D',
                type: 'option',
                quantity: -5,
                price: 103,
                nettedIm: true,
                expirationDate: '2000-01-01',
                strike: 150,
                optionType: 'call',
              },
            ],
          },
        ],
      }),
    )
  })
  await page.reload()
  await expect(page.locator('.strategy-item.expired')).toContainText('Есть истёкшие')
  await expect(page.locator('.positions-table tbody tr.expired')).toContainText('Истёк')
  await expect(page.getByRole('status')).toContainText('Удалите их')
  await expect(page.locator('.positions-table .quantity')).toBeDisabled()
  await expect(page.locator('.positions-table .price')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Пересчитать' })).toBeDisabled()
  await expect(page.locator('.pnl-value')).toHaveText('—')
  expect(portfolioRequests).toHaveLength(0)
  await page.getByRole('button', { name: 'Удалить позицию' }).click()
  await expect(page.locator('.strategy-item.expired')).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.locator('.positions-table tbody tr')).toHaveCount(0)
})
