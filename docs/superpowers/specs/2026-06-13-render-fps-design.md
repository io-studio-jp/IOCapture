# Render モードの FPS 指定

## 背景

動画録画には Live(画面録画)と Render(オフラインレンダリング)の2モードがある。
どちらも内部で `fps = 60` がハードコードされており、UI から変更できない。
Render モードは仮想時計でフレームを生成するため任意 fps を正確に保証できる。
ここに 24 / 30 / 60 の FPS 選択肢を追加する。

## スコープ

- **対象: Render モードのみ。** Live モードは 60 固定のまま(画面録画は実効 fps が負荷依存でブレるため指定の意味が薄い)。
- **選択肢: 24 / 30 / 60。** 任意入力は設けない。
- IPC (`StartRenderArgs.fps`)・`renderRecorder.ts`(仮想時計 / ffmpeg CFR)は既に任意 fps を受け取れるため、変更は **UI → prefs → 呼び出しの配線のみ**。

## 変更点

### 1. Prefs に `renderFps` を追加
`src/shared/ipc-types.ts` の `Prefs` に `renderFps?: number` を追加。
既存の `renderLengthSec` / `renderBlurSamples` / `renderSupersample` と同じ命名・記憶方式に揃える。未設定時のデフォルトは 60。

### 2. VideoControls の Render ブロックに FPS プリセットを追加
`src/renderer/src/components/VideoControls.tsx`:
- 状態 `renderFps`(`window.capture.getPrefs().renderFps ?? 60`)を追加。
- setter で `window.capture.setPrefs({ renderFps })` を呼び永続化。
- Render モード専用ブロック内(Length の近く)に、Motion blur と同じ「グリッドのトグルボタン」スタイルで `24 / 30 / 60` を配置。
- `recording || counting` のとき disabled。
- ラベルは `FPS`。

### 3. startNow から fps を渡す
`startRenderRecording(target, lengthSec, format, { blurSamples, supersample }, renderFps)` の第5引数として渡す。
`recorder.ts` の `startRenderRecording` は既に `fps = 60` の引数を持つため、呼び出し側で実値を渡すだけ。

## 触らない点

- Live モード(`startWindowRecording`、60 固定のまま)。
- ffmpeg / 仮想時計ロジック(任意 fps を既に正しく処理)。

## データフロー

```
UI(renderFps 選択)
  → prefs に保存(renderFps)
  → startRenderRecording(..., renderFps)
  → window.capture.startRender({ ..., fps })   [IPC: StartRenderArgs]
  → renderRecorder.startRender → total = round(durationSec * fps), ffmpeg CFR=fps
```

## テスト

- 新規の純ロジックはほぼ無いため、ユニットテストは最小。
- 手動テスト(`docs/manual-test-checklist.md`)に追記:
  - Render で 24 / 30 / 60 を選び、`durationSec × fps` に等しいフレーム数で書き出されること(進捗の total で確認)。
  - 選んだ fps が prefs に記憶され、再起動後も保持されること。
  - Live モードには FPS UI が出ないこと。
