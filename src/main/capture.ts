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
    const png = image.toPNG()

    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `capture-${Date.now()}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    })
    if (canceled || !filePath) return { ok: false, error: 'canceled' }
    await writeFile(filePath, png)
    return { ok: true, savedPath: filePath }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
