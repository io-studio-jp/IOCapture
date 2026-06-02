import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ensureArtworkView, resetArtworkView } from './artworkView'
import { registerIpc } from './ipc'
import { registerDisplayMediaHandler } from './displayMedia'
import { getWindowBounds, setWindowBounds } from './state'

function createWindow(): void {
  const saved = getWindowBounds()
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: saved?.width ?? 900,
    height: saved?.height ?? 670,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    show: false,
    autoHideMenuBar: true,
    title: 'IOCapture',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // ウィンドウサイズ・位置を記憶（移動/リサイズの確定時と終了時に保存）。
  const saveBounds = (): void => setWindowBounds(mainWindow.getBounds())
  mainWindow.on('resized', saveBounds)
  mainWindow.on('moved', saveBounds)
  mainWindow.on('close', saveBounds)

  // ウィンドウが閉じられたら作品ビューの参照を捨てる（再オープンで作り直すため）。
  mainWindow.on('closed', () => resetArtworkView())

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    ensureArtworkView(mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('io.uurr.iocapture')

  // 開発時もDockアイコンをアプリのものにする（macOS）
  if (process.platform === 'darwin') {
    app.dock?.setIcon(icon)
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  registerIpc(() => BrowserWindow.getAllWindows()[0])
  registerDisplayMediaHandler()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
