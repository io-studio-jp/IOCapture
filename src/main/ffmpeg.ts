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
  RenderResult,
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

/**
 * Smooth方式（画面録画）のwebmを、指定フォーマットへオフライン変換して保存する。
 * mp4=H.264+音声 / webp=アニメーションWebP(ロスレス・音声なし)。元が滑らかなので
 * WebPも滑らかになる（変換はオフラインなのでフレーム落ちしない）。
 */
export async function saveWebmAs(
  data: ArrayBuffer,
  format: 'mp4' | 'webp',
): Promise<RenderResult> {
  if (!ffmpegPath) return { ok: false, error: 'ffmpeg binary not found' }
  const dir = await mkdtemp(join(tmpdir(), 'iocapture-'))
  const webmPath = join(dir, 'in.webm')
  const ext = format === 'webp' ? 'webp' : 'mp4'
  const outPath = join(dir, `out.${ext}`)
  try {
    await writeFile(webmPath, Buffer.from(data))
    const args =
      format === 'webp'
        ? ['-y', '-i', webmPath, '-an', '-c:v', 'libwebp_anim', '-loop', '0', '-lossless', '1', '-compression_level', '6', outPath]
        : ['-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', outPath]
    await run(ffmpegPath, args)
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `capture-${Date.now()}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })
    if (canceled || !filePath) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, canceled: true }
    }
    await copyFile(outPath, filePath)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    return { ok: true, mp4Path: filePath }
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: String(e) }
  }
}
