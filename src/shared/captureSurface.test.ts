import { test, expect } from 'vitest'
import { planCaptureSurface } from './captureSurface'

// 2x(Retina)ディスプレイ: 拡大が必要 → bounds=target/2, zoom=bounds幅/view幅
test('2x display: 600css view -> 3000x2250px target enlarges surface', () => {
  expect(planCaptureSurface({ width: 3000, height: 2250 }, 600, 2)).toEqual({
    kind: 'enlarge',
    bounds: { width: 1500, height: 1125 },
    zoomFactor: 2.5,
    expected: { width: 3000, height: 2250 }
  })
})

// 1xディスプレイ: boundsがそのまま物理px
test('1x display: 600css view -> 3000x2250px target', () => {
  expect(planCaptureSurface({ width: 3000, height: 2250 }, 600, 1)).toEqual({
    kind: 'enlarge',
    bounds: { width: 3000, height: 2250 },
    zoomFactor: 5,
    expected: { width: 3000, height: 2250 }
  })
})

// targetが画面表示の物理px以下なら、表示をそのまま撮って縮小する(スーパーサンプリング)。
// 低DPRで描き直すより高品質で、撮影時の表示変化も無い。
test('target below native physical px -> capture native as-is', () => {
  // view 1900css on 2x = 3800native >= target 3000
  expect(planCaptureSurface({ width: 3000, height: 2000 }, 1900, 2)).toEqual({ kind: 'native' })
})

// ちょうど等しい場合もnative(変更不要)
test('target equal to native physical px -> native', () => {
  expect(planCaptureSurface({ width: 1200, height: 900 }, 600, 2)).toEqual({ kind: 'native' })
})

// 端数scaleFactor(Windowsの1.5x等): boundsは整数に丸め、expectedは丸め後のbounds基準
test('fractional 1.5x display rounds bounds to integers', () => {
  const plan = planCaptureSurface({ width: 1001, height: 751 }, 400, 1.5)
  expect(plan.kind).toBe('enlarge')
  if (plan.kind !== 'enlarge') return
  expect(plan.bounds).toEqual({ width: 667, height: 501 })
  expect(plan.zoomFactor).toBeCloseTo(667 / 400, 10)
  expect(plan.expected).toEqual({ width: 1001, height: 752 }) // round(667*1.5), round(501*1.5)
})

// レイアウト不変条件: bounds幅/zoom = view幅 (構図が崩れない)
test('layout width is preserved: bounds.width / zoomFactor === viewCssWidth', () => {
  const plan = planCaptureSurface({ width: 2160, height: 2160 }, 537, 2)
  expect(plan.kind).toBe('enlarge')
  if (plan.kind !== 'enlarge') return
  expect(plan.bounds.width / plan.zoomFactor).toBeCloseTo(537, 10)
})

// 異常入力(レイアウト前のview幅0等)でもInfinity/NaNを出さない
test('zero view width falls back to zoomFactor 1', () => {
  const plan = planCaptureSurface({ width: 1000, height: 500 }, 0, 2)
  expect(plan.kind).toBe('enlarge')
  if (plan.kind !== 'enlarge') return
  expect(plan.zoomFactor).toBe(1)
  expect(plan.bounds).toEqual({ width: 500, height: 250 })
})
