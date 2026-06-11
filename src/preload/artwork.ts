// 作品view専用preload。Renderモードのときだけ、ページの全スクリプトより先に
// 仮想時計をmain worldへ注入する(preloadはドキュメント解析前に実行される)。
import { ipcRenderer, webFrame } from 'electron'
import { VIRTUAL_CLOCK_BOOTSTRAP } from '../shared/virtualClock'

if (ipcRenderer.sendSync('render:isVirtual') === true) {
  void webFrame.executeJavaScript(VIRTUAL_CLOCK_BOOTSTRAP)
}
