import { session, desktopCapturer } from 'electron'

/** レンダラーの getDisplayMedia 要求に対し、アプリウィンドウ映像＋ループバック音声を返す。 */
export function registerDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] })
        const own = sources.find((s) => /iocapture|capture|record/i.test(s.name)) ?? sources[0]
        if (!own) {
          // ソースが取れない（権限なし等）。空で返してrendererのgetDisplayMediaを拒否させる。
          callback({})
          return
        }
        callback({ video: own, audio: 'loopback' })
      } catch (e) {
        // 画面収録権限が無い等で getSources が失敗するケース。未処理例外にせず拒否で返す。
        console.error('displayMedia: failed to get sources (screen recording permission?):', e)
        callback({})
      }
    },
    { useSystemPicker: false },
  )
}
