import { test, expect } from 'vitest'
import { resolveCaptureMode } from './captureMode'

test('captureMode set -> use it', () => {
  expect(resolveCaptureMode({ captureMode: 'render' })).toBe('render')
})
test('legacy captureEngine screen -> live', () => {
  expect(resolveCaptureMode({ captureEngine: 'screen' })).toBe('live')
})
test('legacy captureEngine frame -> render', () => {
  expect(resolveCaptureMode({ captureEngine: 'frame' })).toBe('render')
})
test('nothing set -> live (操作しても安全なデフォルト)', () => {
  expect(resolveCaptureMode({})).toBe('live')
})
