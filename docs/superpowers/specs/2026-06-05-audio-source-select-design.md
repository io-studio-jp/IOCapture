# VIDEO録画の音声ソース選択 設計書

日付: 2026-06-05

## 目的

VIDEO録画(MP4)の音声を「オフ / システム音声(ループバック) / 特定の音声入力デバイス(BlackHole等の仮想デバイスやマイク)」から選べるようにする。BlackHoleなどを選べば「特定の出力経路に流した音だけ」を録音できる。

## 背景

- 現状は v1.2.0 で追加した「System audio: on/off」トグルのみ。音声はElectronの `audio: 'loopback'`(ScreenCaptureKit)によるシステム全体ミックスで、出力デバイス単位の選択はループバックの仕組み上不可能
- 音声**入力**デバイスを `getUserMedia` で録音する方式なら、仮想デバイス経由で特定経路の音を録れる。マイク録音も同じ仕組みで実現される
- macOSのマイク権限の土台(`NSMicrophoneUsageDescription` / `com.apple.security.device.audio-input`)は整備済み

## 要件

- 音声ソースを1つの統合ドロップダウンで選択: `Audio off` / `System audio` / 各音声入力デバイス
- Smooth(startWindowRecording)・Clean(startRecording)両エンジンに適用
- MP4選択時のみ表示(WebPは音声なし)
- 選択はprefsに永続化。既存の `recordAudio` 設定から移行する
- 選択デバイスが見つからない・取得に失敗した場合は**音声なしで録画を継続**し、トーストで通知する

## 不採用案

- Main側ffmpeg(avfoundation)録音: 映像との同期・プロセス管理が複雑になるだけで利点なし
- トグル+別ドロップダウンの2要素UI: 状態が分散する。統合Selectに一本化

## 変更内容

### 共有型・ロジック — `src/shared/audioSource.ts`(新規)

```ts
/** 音声ソース指定。'off' | 'system' | それ以外はaudioinputのdeviceId */
export type AudioSource = string

export const AUDIO_OFF = 'off'
export const AUDIO_SYSTEM = 'system'

/** prefsから初期音声ソースを解決する(旧recordAudioからの移行を含む) */
export function resolveAudioSource(prefs: { audioSource?: string; recordAudio?: boolean }): AudioSource

/** 列挙デバイスと保存済み選択からSelect項目リストを作る。
 * 保存済みデバイスが列挙に無い場合は `${label} (not connected)` 項目を末尾に追加 */
export function audioSourceOptions(
  devices: { deviceId: string; label: string }[],
  saved: { source: AudioSource; label?: string },
): { value: string; label: string }[]
```

- `resolveAudioSource`: `audioSource` があればそれ、なければ `recordAudio === false ? 'off' : 'system'`
- どちらも純関数としてvitestでテストする

### 永続化 — `src/shared/ipc-types.ts`

- `Prefs` に `audioSource?: string` と `audioSourceLabel?: string` を追加
- 既存の `recordAudio?: boolean` は読み取り専用の移行元として残す(今後の書き込みは `audioSource` のみ)

### 録画処理 — `src/renderer/src/lib/recorder.ts`

- 両関数の `recordAudio: boolean` 引数を `audioSource: string`(デフォルト `'system'`)に変更
- **Clean** (`startRecording`):
  - `'off'` または WebP → 音声取得なし(現行のskipパス)
  - `'system'` → 現行どおり音声用 `getDisplayMedia` ループバック
  - deviceId → `getUserMedia({ audio: { deviceId: { exact: id } } })` で取得し、そのトラックをMediaRecorderで録音
  - 取得失敗(未接続・権限拒否)は既存のcatchで `hadAudio = false` → 音声なし続行
- **Smooth** (`startWindowRecording`):
  - `'off'` → `getDisplayMedia({ audio: false })`
  - `'system'` → `getDisplayMedia({ audio: true })`(現行)
  - deviceId → `getDisplayMedia({ audio: false })` + `getUserMedia` でデバイストラックを取得して `outStream` に追加。取得失敗時は音声なし続行。停止時にデバイストラックも停止する

### UI — `src/renderer/src/components/VideoControls.tsx`

- 「System audio: on/off」トグルボタンを撤去し、shadcn `Select` に置き換え(MP4選択時のみ表示、録画中/カウントダウン中は無効)
- 項目は `audioSourceOptions()` で生成: `Audio off` / `System audio` / 各デバイス
- デバイス列挙: `navigator.mediaDevices.enumerateDevices()` で `audioinput` を取得し、`devicechange` イベントで再列挙
- 選択変更時に `setPrefs({ audioSource, audioSourceLabel })` を保存(labelはデバイス選択時のみ意味を持つ)
- 警告トースト(録画開始後、MP4かつ `hadAudio === false` のとき):
  - `'system'`: 既存文言「Recording without audio. Grant Screen Recording permission for system audio.」
  - deviceId: 「Selected audio device unavailable. Recording without audio.」
  - `'off'`: トーストなし

### Main側

変更なし。音声なし/ありの既存処理パスに合流する。マイク権限のTCCプロンプトは初回 `getUserMedia` 時にOSが自動表示し、拒否されたら取得失敗→音声なし続行のパスに乗る。

## エラーハンドリング

- デバイス取得失敗・権限拒否・デバイス未接続: すべて `hadAudio = false` の音声なし録画に合流し、トーストで通知。録画自体は失敗させない
- `enumerateDevices` が空を返す場合: Selectには `Audio off` / `System audio` のみ並ぶ(機能劣化なし)

## テスト

- vitest: `audioSource.test.ts` で `resolveAudioSource`(audioSource優先 / recordAudio=false→off / 未設定→system)と `audioSourceOptions`(基本項目 / デバイスあり / 保存済みが未接続)をテスト
- 手動確認:
  - System audio → 音声入りmp4(両エンジン)
  - BlackHole等のデバイス選択 → そのデバイスの音だけ入ったmp4(両エンジン)
  - Audio off → 音声なしmp4、トーストなし
  - 選択デバイスを外して録画 → 音声なしで録画継続+トースト
  - 旧設定からの移行: recordAudio=false だった環境で初期値が `Audio off` になる
  - WebP選択時はSelect非表示
