import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

type State = { lastUrl?: string }

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
