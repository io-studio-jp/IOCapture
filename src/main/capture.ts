import { dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { withDeviceScale, getArtworkView } from './artworkView'
import { deriveDeviceScaleFactor } from '../shared/dpr'
import type {
  CaptureStillArgs,
  CaptureStillResult,
  CaptureStillToArgs,
} from '../shared/ipc-types'
import type { TargetSize } from '../shared/resolution'

// 高DPRで撮影し、指定ピクセルへ厳密に整えたPNGバッファを返す。
async function capturePng(target: TargetSize): Promise<Buffer> {
  const view = getArtworkView()
  if (!view) throw new Error('view not ready')
  const scale = deriveDeviceScaleFactor(target.width, view.getBounds().width)
  const image = await withDeviceScale(scale, async (v) => v.webContents.capturePage())
  const sized =
    image.getSize().width === target.width && image.getSize().height === target.height
      ? image
      : image.resize({ width: target.width, height: target.height, quality: 'best' })
  return sized.toPNG()
}

export async function captureStill(args: CaptureStillArgs): Promise<CaptureStillResult> {
  try {
    const png = await capturePng(args.target)
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `capture-${Date.now()}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    })
    if (canceled || !filePath) return { ok: false, error: 'canceled' }
    await writeFile(filePath, png)
    return { ok: true, savedPath: filePath, width: args.target.width, height: args.target.height }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ダイアログ無しで指定ディレクトリへ連番保存する（連続撮影用）。
export async function captureStillTo(args: CaptureStillToArgs): Promise<CaptureStillResult> {
  try {
    // パストラバーサル防止: nameは単純なファイル名(.png)のみ許可し、
    // 解決後のパスが dir 配下に収まることを保証する。
    if (!/^[A-Za-z0-9._-]+\.png$/.test(args.name)) {
      return { ok: false, error: 'invalid file name' }
    }
    const dir = resolve(args.dir)
    const savedPath = resolve(dir, args.name)
    if (savedPath !== join(dir, args.name) || !savedPath.startsWith(dir + sep)) {
      return { ok: false, error: 'invalid path' }
    }
    const png = await capturePng(args.target)
    await writeFile(savedPath, png)
    return { ok: true, savedPath, width: args.target.width, height: args.target.height }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
