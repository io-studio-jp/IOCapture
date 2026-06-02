// 録画フレーム（BGRAバッファ）にカーソル（矢印）を直接描き込むためのスプライト。
// X=黒の輪郭, O=白の塗り, '.'=透明。ホットスポットは左上(0,0)。
const ARROW = [
  'X...............',
  'XX..............',
  'XOX.............',
  'XOOX............',
  'XOOOX...........',
  'XOOOOX..........',
  'XOOOOOX.........',
  'XOOOOOOX........',
  'XOOOOOOOX.......',
  'XOOOOOOOOX......',
  'XOOOOOOOOOX.....',
  'XOOOOOXXXXXX....',
  'XOOXOOX.........',
  'XOX.XOOX........',
  'XX..XOOX........',
  'X....XOOX.......',
  '.....XOOX.......',
  '......XX........',
]

function setPixel(buf: Buffer, w: number, h: number, x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= w || y >= h) return
  const i = (y * w + x) * 4
  // toBitmap は BGRA
  buf[i] = b
  buf[i + 1] = g
  buf[i + 2] = r
  buf[i + 3] = 255
}

/** BGRAバッファの (cx, cy)（矢印のホットスポット）に矢印を scale 倍で描く。 */
export function drawCursor(
  buf: Buffer,
  w: number,
  h: number,
  cx: number,
  cy: number,
  scale: number,
): void {
  const s = Math.max(1, Math.round(scale))
  for (let ry = 0; ry < ARROW.length; ry++) {
    const row = ARROW[ry]
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx]
      if (ch === '.') continue
      const r = ch === 'X' ? 0 : 255
      const g = r
      const b = r
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          setPixel(buf, w, h, cx + rx * s + dx, cy + ry * s + dy, r, g, b)
        }
      }
    }
  }
}
