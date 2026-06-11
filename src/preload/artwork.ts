// 作品view専用preload。Renderモードのときだけ、ページの全スクリプトより先に
// 仮想時計をmain worldへ注入する(preloadはドキュメント解析前に実行される)。
// ※ preloadはメインフレームのみに適用されるため、iframe内の作品には注入されない。
import { ipcRenderer, webFrame } from 'electron'
import { IPC } from '../shared/ipc-types'
import { VIRTUAL_CLOCK_BOOTSTRAP } from '../shared/virtualClock'

if (ipcRenderer.sendSync(IPC.renderIsVirtual) === true) {
  webFrame
    .executeJavaScript(VIRTUAL_CLOCK_BOOTSTRAP)
    .catch((e) => console.error('[artwork preload] virtual clock injection failed', e))
}
