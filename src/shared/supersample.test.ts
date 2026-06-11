import { test, expect } from 'vitest'
import { planSupersample } from './supersample'

test('disabled returns target unchanged', () => {
  expect(planSupersample({ width: 3840, height: 2160 }, false)).toEqual({
    width: 3840,
    height: 2160
  })
})

test('enabled doubles the render size', () => {
  expect(planSupersample({ width: 3000, height: 2000 }, true)).toEqual({
    width: 6000,
    height: 4000
  })
})

test('enabled caps at GPU limit keeping aspect', () => {
  // 2倍(20000×10000)は16384を超える → 比率を保って上限へ(16384×8192)
  const r = planSupersample({ width: 10000, height: 5000 }, true)
  expect(r.width).toBe(16384)
  expect(r.height).toBe(8192)
})
