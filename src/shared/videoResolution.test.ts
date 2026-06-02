import { test, expect } from 'vitest'
import { videoPresetsFor } from './videoResolution'

test('square presets are NxN', () => {
  const presets = videoPresetsFor({ w: 1, h: 1 })
  const p1080 = presets.find((p) => p.label === '1080')!
  expect(p1080.size).toEqual({ width: 1080, height: 1080 })
})
test('16:9 1080 preset is 1920x1080', () => {
  const presets = videoPresetsFor({ w: 16, h: 9 })
  const p = presets.find((p) => p.label === '1080')!
  expect(p.size).toEqual({ width: 1920, height: 1080 })
})
test('includes match-frame entry', () => {
  const presets = videoPresetsFor({ w: 4, h: 5 })
  expect(presets.some((p) => p.label === '枠に合わせる')).toBe(true)
})
