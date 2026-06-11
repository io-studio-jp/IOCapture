# Render/Liveモード再編 — 画質とFPS最優先の録画設計

日付: 2026-06-11
ステータス: 設計

## 背景と要件

画質調査の結果、以下が判明・修正済み（本設計の前提となる基盤）:

- `enableDeviceEmulation` の `deviceScaleFactor` は `capturePage` に反映されない。代わりに
  「view boundsの拡大 + `setZoomFactor` でレイアウト幅維持」(`planCaptureSurface`)で
  任意解像度の実レンダリングが可能（実測済み。ウィンドウ外でも左端2pxスリバーを残せば描画される）
- 撮影中の見た目はフリーズ画像（直前スナップショットのオーバーレイ）で隠せる
- リアルタイム録画はエンコード律速で4K60を保証できない（capturePage自体は4K相当で~49fps）

整理した要件:

| 項目 | 要件 |
|---|---|
| 静止画 | 任意解像度を実レンダリングで撮る（実装済み方式で確定）|
| 動画(生成作品) | **4K60をフレーム落ちなしで確実に**。音声不要。録画中プレビュー静止は許容 |
| 動画(操作実演) | リアルタイム・音声あり・カーソルあり。解像度は画面上限で許容 |

## 全体方針

現在の録画エンジン切替「Smooth / Clean」を、用途ベースの2モードに再編する。

| | **Live** | **Render** |
|---|---|---|
| 用途 | 操作の実演・音が本質の記録 | 自動で動く生成作品の高品質書き出し |
| 方式 | 画面録画（現Smoothを継承） | 仮想時計オフラインレンダリング（新規） |
| 解像度 | 画面表示が上限（超過分はキャップ） | 任意（4K/5K可）。プリセット同様 |
| FPS | 実時間60fps目標（OS録画なので滑らか） | **固定60fps保証**（実時間より遅く描いて組み立て） |
| 音声 | system / 入力デバイス / off | なし |
| カーソル | 常に入る | なし |
| 録画中の表示 | 通常どおり | フリーズ画像 + 進捗表示 |
| 録画範囲 | 今この瞬間から | **ページを再読み込みして t=0 から**（決定的な開始） |
| 長さ | Stopで止める | 事前に秒数を指定（+キャンセル可） |

現Clean（リアルタイムcapturePageループ）はRenderに置き換えられるため**廃止**する。
カーソル合成（`cursorSprite.ts`）も同時に不要になるため削除する。

## Renderモードの設計

### 1. 仮想時計（time virtualization）

作品ページの時間進行を実時間から切り離し、Mainが1フレームずつ進める。
timecut/timeweb で実績のある方式。

- **注入タイミング**: 作品viewのpreloadスクリプトで、ページの全スクリプトより先に
  グローバルを差し替える。差し替えるのは Renderモードのフラグが立っているときだけ
  （preload冒頭で `ipcRenderer.sendSync('render:isVirtual')` を確認）
- **差し替え対象**: `performance.now` / `Date.now` / `new Date()`(引数なし) /
  `requestAnimationFrame` / `cancelAnimationFrame` / `setTimeout` / `setInterval` /
  `clearTimeout` / `clearInterval`
- **公開API**: `window.__iocapRender.step(ms)` — 仮想時刻をms進め、期限の来たタイマーと
  rAFコールバックを実行し、完了をPromiseで返す
- **開始フロー**: Record(Render)押下 → フラグ設定 → `wc.reload()`（仮想時計付きで作品が
  t=0から始まる）→ 拡大サーフェス適用 → ループ
- **終了フロー**: フラグ解除 → `wc.reload()` で通常の実時間動作に戻す
- **制約（ドキュメント化する）**: CSSアニメーション/`<video>`/WebAudio駆動の
  ビジュアルは仮想時計に追従しない。rAF/タイマーベースの作品（生成アートの大半）が対象

### 2. レンダリングループ（Main）

```
startRender(target, fps=60, durationSec, format):
  フラグON → reload → 仮想時計の準備完了を待つ
  フリーズ画像表示 + withCaptureSurfaceの拡大サーフェス適用(録画中保持)
  ffmpeg起動(CFR): -f rawvideo -r 60 -i pipe:0 → libx264 -preset medium -crf 15
                    (webp時: libwebp_anim lossless)
  for i in 0..durationSec*fps:
    executeJavaScript(`__iocapRender.step(1000/fps)`)
    capturePage → toBitmap → stride詰め → stdin書き込み(バックプレッシャー待ち)
    進捗をレンダラーへ送信(フレームi/N, 経過時間)
  stdin閉じ → mux不要(音なし) → 保存ダイアログ
  finally: サーフェス復元 → フラグOFF → reload → フリーズ解除
```

- タイムスタンプは固定60fps（wallclock不使用）。**描画がどれだけ遅くても完成品は60fps**
- エンコードは時間をかけられるので `-preset medium -crf 15`（現行realtimeのveryfast/16より高品質）
- キャンセル: ループ中断 → ffmpeg破棄 → 後始末は同じ

### 3. UI（VideoControls）

- エンジン切替を `Live / Render` に変更（prefs移行: `screen`→`live`, `frame`→`render`）
- Render選択時: Audioセレクト・カーソルトグルを隠し、**Length(秒)** 入力
  （プリセット 5/10/30/60 + 自由入力）を表示
- 録画中: フリーズ画像の上に進捗（`Rendering 4K60 … 312/600 frames`）とCancelボタン
- 解像度プリセットは共通（1080/1440/2160/Match frame）。Renderでは画面超えも実解像度で出る

### 4. 整理・削除

- `frameRecorder.ts`: realtimeループ（wallclock/vfr）を撤去しRenderループに置換
- `cursorSprite.ts` と `includeCursor` UI・prefs: 削除（Liveは実カーソルが映る）
- `recorder.ts` の `startRecording`（realtime Clean用）: Render用のIPC呼び出しに置換。
  録音ロジックはLive専用に整理
- Liveは現Smoothのコードをほぼそのまま使う（今回のソース解像度キャップ済み）

## 静止画（確定事項の明文化）

- target ≤ 画面表示物理px: 表示をそのまま撮り高品質縮小（スーパーサンプリング）
- target > 画面表示物理px: 拡大サーフェスで実レンダリング（フリーズ画像で隠す）
- 将来の派生機能（今回は対象外）: Render基盤を使った「指定時刻の1フレーム書き出し」

## エラーハンドリング

- 仮想時計の準備失敗（preload不達・reload失敗）: エラートーストで中断、通常状態へ復帰
- `step()` がタイムアウト（作品が無限ループ等）: 1フレーム最大5秒でタイムアウトしたら
  録画を中断し、エラートーストで知らせる（部分的な動画は保存しない）
- ffmpeg異常終了: 中断・後始末・エラートースト
- 録画中のウィンドウクローズ: 後始末（ffmpeg kill・tmp削除）してから閉じる

## テスト方針

- **純ロジック(vitest)**: 仮想時計モジュール（タイマー期限順序・rAFバッチ・step境界）、
  CFRフレーム数計算、prefs移行(`screen`→`live`等)
- **実機検証スクリプト**: 仮想時計注入→step→capturePageの一連を実ページで確認
  （/tmp実験ハーネスの流用）
- **手動チェックリスト**: docs/manual-test-checklist.md にRender/Live項目を追記

## 受け入れ条件

1. Renderモードで4K(2160プリセット)・60fps・任意秒数の動画が、重い作品でも
   フレーム落ちゼロで書き出せる（出力をffprobeで確認: 3840×2160, 60fps, フレーム数=秒数×60）
2. Render録画中、プレビューはフリーズ画像+進捗表示で、終了後に通常表示へ戻る
3. Liveモードは現Smooth相当の挙動（音声・カーソル・画面解像度キャップ）を維持
4. 静止画の挙動は変わらない
