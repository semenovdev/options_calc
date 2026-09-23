import { describe, expect, it } from 'vitest'

import { signed } from './format'

describe('signed', () => {
  it.each([
    [1.23, '1,23'],
    [0.01, '0,01'],
    [-1.23, '-1,23'],
    [0.0004, '+0'],
    [-0.0004, '-0'],
    [0, '0'],
    [-0, '-0'],
    [null, '—'],
    [undefined, '—'],
    [NaN, '—'],
    [Infinity, '—'],
  ])('formats %s as %s', (value, expected) => {
    expect(signed(value)).toBe(expected)
  })
})
