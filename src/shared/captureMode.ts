import type { Prefs } from './ipc-types'

export type CaptureMode = 'live' | 'render'

/** 旧captureEngine(screen/frame)からの移行を含めて録画モードを解決する。 */
export function resolveCaptureMode(
  prefs: Pick<Prefs, 'captureMode' | 'captureEngine'>
): CaptureMode {
  if (prefs.captureMode === 'live' || prefs.captureMode === 'render') return prefs.captureMode
  if (prefs.captureEngine === 'screen') return 'live'
  if (prefs.captureEngine === 'frame') return 'render'
  return 'live'
}
