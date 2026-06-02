import type { ElectronAPI } from '@electron-toolkit/preload'
import type { CaptureAPI } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    capture: CaptureAPI
  }
}
