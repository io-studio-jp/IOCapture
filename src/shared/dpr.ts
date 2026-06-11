import type { TargetSize } from './resolution'

export const MAX_GPU_DIMENSION = 16384

/** どちらかの辺が上限超なら、比率を保って上限内に縮める。 */
export function capToGpuLimit(size: TargetSize): { ok: boolean; size: TargetSize } {
  const maxDim = Math.max(size.width, size.height)
  if (maxDim <= MAX_GPU_DIMENSION) return { ok: true, size }
  const scale = MAX_GPU_DIMENSION / maxDim
  return {
    ok: false,
    size: {
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
    },
  }
}
