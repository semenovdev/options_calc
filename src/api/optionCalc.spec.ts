import { afterEach, describe, expect, it, vi } from 'vitest'

import { optionCalcApi } from './optionCalc'

describe('optionCalcApi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('flattens call and put sides of the MOEX option board', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            call: [{ secid: 'CALL-1', strike: 280 }],
            put: [{ secid: 'PUT-1', strike: 280 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    await expect(optionCalcApi.getOptionBoard('SBER', 'SERIES')).resolves.toEqual([
      { secid: 'CALL-1', strike: 280, option_type: 'call' },
      { secid: 'PUT-1', strike: 280, option_type: 'put' },
    ])
  })
})
