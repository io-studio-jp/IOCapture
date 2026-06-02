import { execFile } from 'child_process'
import { promisify } from 'util'
import ffmpegStatic from 'ffmpeg-static'
import type { ConvertToMp4Args, ConvertToMp4Result } from '../shared/ipc-types'

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
