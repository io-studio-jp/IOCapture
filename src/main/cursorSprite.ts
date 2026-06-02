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

export const ARROW_ROWS = ARROW.length // 18
const ARROW_COLS = ARROW[0].length // 16

function setPixel(buf: Buffer, w: number, h: number, x: number, y: number, v: number): void {
  if (x < 0 || y < 0 || x >= w || y >= h) return
  const i = (y * w + x) * 4
  // toBitmap は BGRA。白(255)/黒(0)はR=G=Bなのでそのまま代入。
  buf[i] = v
  buf[i + 1] = v
  buf[i + 2] = v
  buf[i + 3] = 255
}

/**
 * BGRAバッファの (cx, cy)（矢印のホットスポット＝左上）に矢印を描く。
 * scale は小数可（出力ピクセルを走査し最近傍でスプライトを参照）。
 */
export function drawCursor(
  buf: Buffer,
  w: number,
  h: number,
  cx: number,
  cy: number,
  scale: number,
): void {
  const s = Math.max(0.5, scale)
  const outW = Math.round(ARROW_COLS * s)
  const outH = Math.round(ARROW_ROWS * s)
  for (let oy = 0; oy < outH; oy++) {
    const sy = Math.floor(oy / s)
    const row = ARROW[sy]
    if (!row) continue
    for (let ox = 0; ox < outW; ox++) {
      const ch = row[Math.floor(ox / s)]
      if (!ch || ch === '.') continue
      setPixel(buf, w, h, cx + ox, cy + oy, ch === 'X' ? 0 : 255)
    }
  }
}
