import { test, expect } from 'vitest'
import { deriveDeviceScaleFactor, MAX_GPU_DIMENSION, capToGpuLimit } from './dpr'

test('deriveDeviceScaleFactor = target / css', () => {
  expect(deriveDeviceScaleFactor(2400, 800)).toBe(3)
})
test('capToGpuLimit leaves small sizes untouched', () => {
  expect(capToGpuLimit({ width: 2000, height: 1000 })).toEqual({
    ok: true,
    size: { width: 2000, height: 1000 },
  })
})
test('capToGpuLimit scales down oversize keeping aspect', () => {
  const res = capToGpuLimit({ width: 32768, height: 16384 })
  expect(res.ok).toBe(false)
  expect(res.size.width).toBe(MAX_GPU_DIMENSION)
  expect(res.size.height).toBe(MAX_GPU_DIMENSION / 2)
})
