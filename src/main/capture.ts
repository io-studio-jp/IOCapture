import { dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { withDeviceScale, getArtworkView } from './artworkView'
import { deriveDeviceScaleFactor } from '../shared/dpr'
import type { CaptureStillArgs, CaptureStillResult } from '../shared/ipc-types'

export async function captureStill(args: CaptureStillArgs): Promise<CaptureStillResult> {
  const view = getArtworkView()
  if (!view) return { ok: false, error: 'view not ready' }

  const bounds = view.getBounds()
  const cssW = bounds.width
  const scale = deriveDeviceScaleFactor(args.target.width, cssW)

  try {
    const image = await withDeviceScale(scale, async (v) => {
      return v.webContents.capturePage()
    })
    // capturePageの実寸はDPRの丸め等で目標と数%ずれることがあるため、
    // 厳密に指定ピクセルへ整える（大きい場合はダウンスケールで高品質、足りない場合のみ拡大）。
    const sized =
      image.getSize().width === args.target.width && image.getSize().height === args.target.height
        ? image
        : image.resize({ width: args.target.width, height: args.target.height, quality: 'best' })
    const png = sized.toPNG()

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
