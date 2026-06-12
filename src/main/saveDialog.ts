import { dialog, type SaveDialogOptions, type SaveDialogReturnValue } from 'electron'
import { getMainWindow } from './artworkView'

/**
 * 保存ダイアログをメインウィンドウのシートとして表示する。
 * 親無しダイアログは、長いレンダリング中にアプリからフォーカスが外れていると
 * 他ウィンドウの背後や別ディスプレイに出てしまい、UIが「Finalizing…」のまま
 * 止まったように見える(実測)。シートなら必ずウィンドウ上に出る。
 */
export async function showSaveDialogAttached(
  opts: SaveDialogOptions
): Promise<SaveDialogReturnValue> {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    // 最小化や背面にあっても保存待ちに気づけるように前面へ出す
    win.show()
    return dialog.showSaveDialog(win, opts)
  }
  return dialog.showSaveDialog(opts)
}
