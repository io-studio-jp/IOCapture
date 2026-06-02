import { test, expect } from 'vitest'
import { parseAspect, aspectRatio, ASPECT_PRESETS } from './aspect'

test('parseAspect parses "16:9"', () => {
  expect(parseAspect('16:9')).toEqual({ w: 16, h: 9 })
})
test('parseAspect trims spaces', () => {
  expect(parseAspect(' 4 : 5 ')).toEqual({ w: 4, h: 5 })
})
test('parseAspect rejects non-positive', () => {
  expect(parseAspect('0:5')).toBeNull()
  expect(parseAspect('4:-1')).toBeNull()
  expect(parseAspect('abc')).toBeNull()
})
test('aspectRatio returns w/h', () => {
  expect(aspectRatio({ w: 16, h: 9 })).toBeCloseTo(16 / 9)
})
test('presets include 1:1 and 16:9', () => {
  const labels = ASPECT_PRESETS.map((p) => p.label)
  expect(labels).toContain('1:1')
  expect(labels).toContain('16:9')
})
