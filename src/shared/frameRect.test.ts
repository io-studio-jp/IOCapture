import { test, expect } from 'vitest'
import { computeFrameRect } from './frameRect'

test('square aspect in wide stage is centered horizontally', () => {
  const r = computeFrameRect({ width: 400, height: 200 }, { w: 1, h: 1 }, 0)
  expect(r).toEqual({ x: 100, y: 0, width: 200, height: 200 })
})
test('16:9 in tall stage is centered vertically', () => {
  const r = computeFrameRect({ width: 160, height: 200 }, { w: 16, h: 9 }, 0)
  expect(r).toEqual({ x: 0, y: 55, width: 160, height: 90 })
})
test('padding shrinks the available area', () => {
  const r = computeFrameRect({ width: 220, height: 220 }, { w: 1, h: 1 }, 10)
  expect(r).toEqual({ x: 10, y: 10, width: 200, height: 200 })
})
