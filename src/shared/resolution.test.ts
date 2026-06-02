import { test, expect } from 'vitest'
import { cmToPx, targetFromLongEdge, targetFromWidthCm } from './resolution'

test('cmToPx: 10cm @ 300dpi = 1181px', () => {
  expect(cmToPx(10, 300)).toBe(1181)
})
test('targetFromLongEdge keeps aspect, long edge exact (landscape)', () => {
  expect(targetFromLongEdge({ w: 16, h: 9 }, 1600)).toEqual({ width: 1600, height: 900 })
})
test('targetFromLongEdge keeps aspect, long edge exact (portrait)', () => {
  expect(targetFromLongEdge({ w: 4, h: 5 }, 1000)).toEqual({ width: 800, height: 1000 })
})
test('targetFromWidthCm derives height from aspect', () => {
  expect(targetFromWidthCm({ w: 1, h: 1 }, 10, 300)).toEqual({ width: 1181, height: 1181 })
})
