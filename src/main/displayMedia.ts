import { session, desktopCapturer } from 'electron'

/** レンダラーの getDisplayMedia 要求に対し、アプリウィンドウ映像＋ループバック音声を返す。 */
export function registerDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ['window', 'screen'] }).then((sources) => {
        const own = sources.find((s) => /record|capture/i.test(s.name)) ?? sources[0]
        callback({ video: own, audio: 'loopback' })
      })
    },
    { useSystemPicker: false },
  )
}
