import { app } from 'electron'

const REPO = 'io-studio-jp/IOCapture'

export type UpdateInfo = { update: boolean; version?: string; url?: string }

// "v1.2.3" / "1.2.3" を比較し、latest が current より新しければ true。
function isNewer(latest: string, current: string): boolean {
  const a = latest.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const b = current.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

/** GitHubの最新リリースを見て、現在のアプリより新しければ情報を返す。失敗時は update:false。 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'IOCapture', Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return { update: false }
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    const tag = data.tag_name
    if (!tag) return { update: false }
    if (isNewer(tag, app.getVersion())) {
      return {
        update: true,
        version: tag.replace(/^v/, ''),
        url: data.html_url ?? `https://github.com/${REPO}/releases/latest`,
      }
    }
    return { update: false }
  } catch {
    // ネットワークエラー等は黙って無視。
    return { update: false }
  }
}
