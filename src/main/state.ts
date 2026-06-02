import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import type { Prefs } from '../shared/ipc-types'

export type WindowBounds = { x: number; y: number; width: number; height: number }
type State = { lastUrl?: string; windowBounds?: WindowBounds; prefs?: Prefs }

function file(): string {
  return join(app.getPath('userData'), 'state.json')
}

function read(): State {
  try {
    return JSON.parse(readFileSync(file(), 'utf-8')) as State
  } catch {
    return {}
  }
}

function write(s: State): void {
  try {
    writeFileSync(file(), JSON.stringify(s))
  } catch {
    // 保存失敗は致命ではないので握りつぶす
  }
}

export function getLastUrl(): string | null {
  return read().lastUrl ?? null
}

export function setLastUrl(url: string): void {
  const s = read()
  s.lastUrl = url
  write(s)
}

export function getWindowBounds(): WindowBounds | null {
  return read().windowBounds ?? null
}

export function setWindowBounds(bounds: WindowBounds): void {
  const s = read()
  s.windowBounds = bounds
  write(s)
}

// 機能3: プリセット記憶
export function getPrefs(): Prefs {
  return read().prefs ?? {}
}

export function setPrefs(p: Prefs): void {
  const s = read()
  s.prefs = { ...s.prefs, ...p }
  write(s)
}
