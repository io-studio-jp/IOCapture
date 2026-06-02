import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, copyFile, rm, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { dialog } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import type {
  ConvertToMp4Args,
  ConvertToMp4Result,
  StopFrameCaptureResult,
} from '../shared/ipc-types'

const run = promisify(execFile)

// パッケージ後は ffmpeg-static のバイナリが app.asar 内のパスを返すが、asar内の
// 実行ファイルは起動できない。asarUnpack した app.asar.unpacked 側を指すよう補正する
// （開発時は app.asar を含まないので no-op）。
const ffmpegPath = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : null

export async function convertToMp4(args: ConvertToMp4Args): Promise<ConvertToMp4Result> {
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg binary not found' }
  const mp4Path = args.webmPath.replace(/\.webm$/i, '') + '.mp4'
  try {
    await run(ffmpegPath, [
      '-y',
      '-i', args.webmPath,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      mp4Path,
    ])
    return { ok: true, mp4Path }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** カーソルあり録画（ウィンドウキャプチャ）のwebmをmp4へ変換し、保存ダイアログで保存する。 */
export async function saveWebmAsMp4(data: ArrayBuffer): Promise<StopFrameCaptureResult> {
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg binary not found' }
  const dir = await mkdtemp(join(tmpdir(), 'iocapture-'))
  const webmPath = join(dir, 'in.webm')
  const mp4Path = join(dir, 'out.mp4')
  try {
    await writeFile(webmPath, Buffer.from(data))
    await run(ffmpegPath, [
      '-y',
      '-i', webmPath,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      mp4Path,
    ])
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `capture-${Date.now()}.mp4`,
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    })
    if (canceled || !filePath) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, canceled: true }
    }
    await copyFile(mp4Path, filePath)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    return { ok: true, mp4Path: filePath }
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: String(e) }
  }
}
