import { describe, it, expect } from 'vitest'
import { rmsLevel } from './audioLevel'

describe('rmsLevel', () => {
  it('無音(全サンプル128)は0', () => {
    expect(rmsLevel(new Uint8Array(256).fill(128))).toBe(0)
  })
  it('フルスケール(全サンプル0 = -1.0)は1', () => {
    expect(rmsLevel(new Uint8Array(256).fill(0))).toBe(1)
  })
  it('半振幅(全サンプル192 = +0.5)は0.5', () => {
    expect(rmsLevel(new Uint8Array(256).fill(192))).toBe(0.5)
  })
  it('負方向の半振幅(全サンプル64 = -0.5)も0.5', () => {
    expect(rmsLevel(new Uint8Array(256).fill(64))).toBe(0.5)
  })
  it('空配列は0', () => {
    expect(rmsLevel(new Uint8Array(0))).toBe(0)
  })
})
