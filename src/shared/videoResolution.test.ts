import { test, expect } from 'vitest'
import { videoPresetsFor, capToSourceWidth } from './videoResolution'

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
  expect(presets.some((p) => p.label === 'Match frame')).toBe(true)
})

// ソースが十分大きければターゲットそのまま
test('capToSourceWidth keeps target when source is large enough', () => {
  expect(capToSourceWidth({ width: 1920, height: 1080 }, 2400)).toEqual({
    width: 1920,
    height: 1080,
  })
})
// ソースが小さい場合はアスペクト維持・偶数丸めで縮める(引き伸ばし禁止)
test('capToSourceWidth shrinks oversize target to source width (even-rounded)', () => {
  expect(capToSourceWidth({ width: 1920, height: 1080 }, 1400)).toEqual({
    width: 1400,
    height: 788,
  })
})
// 極端に小さいソースでも最低2pxを保つ
test('capToSourceWidth never goes below 2px', () => {
  const r = capToSourceWidth({ width: 1920, height: 1080 }, 1)
  expect(r.width).toBeGreaterThanOrEqual(2)
  expect(r.height).toBeGreaterThanOrEqual(2)
})
