export type Aspect = { w: number; h: number }

export function parseAspect(input: string): Aspect | null {
  const m = input.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!(w > 0) || !(h > 0)) return null
  return { w, h }
}

export function aspectRatio(a: Aspect): number {
  return a.w / a.h
}

export const ASPECT_PRESETS: { label: string; aspect: Aspect }[] = [
  { label: '1:1', aspect: { w: 1, h: 1 } },
  { label: '4:5', aspect: { w: 4, h: 5 } },
  { label: '5:4', aspect: { w: 5, h: 4 } },
  { label: '3:2', aspect: { w: 3, h: 2 } },
  { label: '2:3', aspect: { w: 2, h: 3 } },
  { label: '16:9', aspect: { w: 16, h: 9 } },
  { label: '9:16', aspect: { w: 9, h: 16 } },
]
