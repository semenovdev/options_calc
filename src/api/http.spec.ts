import { describe, expect, it } from 'vitest'

import { queryString } from './http'

describe('queryString', () => {
  it('encodes values and omits empty parameters', () => {
    expect(queryString({ query: 'Si futures', asset_type: 'futures', empty: undefined })).toBe(
      '?query=Si+futures&asset_type=futures',
    )
  })

  it('returns an empty string when no parameters are present', () => {
    expect(queryString({ query: '', page: undefined })).toBe('')
  })
})
