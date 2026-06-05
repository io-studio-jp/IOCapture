# VIDEO録画のシステム音声オン/オフ切替 設計書

日付: 2026-06-05

## 目的

VIDEOモード(MP4出力)で、システム音声(内部音声ループバック)を録音するかどうかをユーザーが選べるようにする。現状は常に録音を試みる。

## 要件

- Smooth(画面録画)・Clean(フレーム取得)両エンジンに同じトグルが適用される
- デフォルトは「音声あり」(現状の挙動を維持)
- 設定はprefsに永続化される
- WebP出力は元々音声なしのため、トグルの対象外

## アプローチ

**録音自体をスキップする方式**を採用する。音声オフ時は `getDisplayMedia` での音声取得を行わない。録音してから書き出し時に捨てる案は、無駄が多く録画中切替の需要もないため不採用(YAGNI)。

## 変更内容

### UI — `src/renderer/src/components/VideoControls.tsx`

- 「Cursor in video」と同様のトグルボタン「System audio: on / off」を追加(アイコン: Volume2 / VolumeX)
- 表示条件: `format === 'mp4'` のときのみ表示(WebP時は非表示)
- 録画中・カウントダウン中は `disabled`
- 状態は `window.capture.getPrefs().recordAudio ?? true` で初期化し、変更時に `setPrefs` で保存
- 音声オフ時は録画開始後の「Recording without audio. Grant Screen Recording permission…」警告トーストを出さない

### 永続化 — `src/shared/ipc-types.ts`

- `Prefs` に `recordAudio?: boolean` を追加(未設定は `true` 扱い)

### 録画処理 — `src/renderer/src/lib/recorder.ts`

- `startRecording` / `startWindowRecording` に `recordAudio: boolean` 引数を追加(デフォルト `true`)
- **Clean** (`startRecording`): `recordAudio === false` なら音声用 `getDisplayMedia` 呼び出し自体をスキップし、`hadAudio = false` のまま `stopFrameCapture(null)` へ。画面録画権限プロンプトも発生しない。
- **Smooth** (`startWindowRecording`): `getDisplayMedia({ audio: recordAudio })` とし、オフ時は音声トラックを `outStream` に追加しない。

### Main側

変更なし。音声なしのケース(`audio === null` / 音声トラックなしwebm)は既に両エンジンで処理済み。

## エラーハンドリング

既存のまま。音声オフは「音声取得失敗」と同じ既存パス(音声なしmp4)に合流するため、新たな失敗モードは増えない。

## テスト

- 純粋ロジックの追加はないため、ユニットテストの追加対象なし
- 手動確認:
  - Clean + MP4 + 音声オン → 音声入りmp4
  - Clean + MP4 + 音声オフ → 音声なしmp4(権限プロンプトなし)
  - Smooth + MP4 + 音声オン/オフ → 同上
  - WebP選択時 → トグル非表示
  - アプリ再起動後も設定が保持される
