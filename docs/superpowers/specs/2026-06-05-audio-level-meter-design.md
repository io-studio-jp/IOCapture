# VIDEOオーディオレベルメーター 設計書

日付: 2026-06-05

## 目的

VIDEO(MP4)の音声ソース選択の下に、選択中ソースの入力レベルを常時表示するレベルメーターを追加する。録画を始める前に「音がちゃんと来ているか」を目で確認できるようにする。

## 背景

- 音声ソース選択(off / system / 入力デバイス)は実装済み(`2026-06-05-audio-source-select-design.md`)
- 音が入っているかは録画後にファイルを再生するまでわからない。特にBlackHole等の仮想デバイスはルーティングミスが起きやすく、無音録画に気づきにくい
- Electron側で `getDisplayMedia` は `setDisplayMediaRequestHandler` により自動許可されるため、システム音声のプレビューもユーザー操作なしで取得できる

## 要件

- MP4選択時、Audio Selectの直下にレベルメーターを常時表示(録画前から)
- System audio選択時も常時プレビューする(裏でループバックセッションを開きっぱなしにする)
- `Audio off` 選択時・WebP選択時は非表示(プレビューストリームも開かない)
- 録画中もメーター表示を継続する
- ストリーム取得失敗(画面収録権限なし・デバイス未接続・マイク権限拒否)時はメーター非表示。録画動作には影響させない

## 不採用案

- **recorder.tsからAnalyserNodeを公開**(録画中は実録音トラックを監視): プレビューと録音は同じ音源なので表示は一致し、実益が薄い割にrecorder.ts改修+二重管理で複雑になる
- **音の有無だけの○×表示**: 実装は最小だがレベルの情報量がなく、要望(インジケーター)を満たさない

## 変更内容

### 共有ロジック — `src/shared/audioLevel.ts`(新規、TDD)

```ts
/** AnalyserNodeのtime domainデータ(Uint8Array, 128中心)からRMSレベル(0〜1)を計算する */
export function rmsLevel(data: Uint8Array): number
```

- 各サンプルを `(v - 128) / 128` で-1〜1に正規化し、二乗平均平方根を返す
- 無音(全128)→0、フルスケール矩形波→1。表示時の対数変換等は行わない(視認性が足りなければ表示側で調整)
- 純関数としてvitestでテストする

### プレビューフック — `src/renderer/src/lib/useAudioLevel.ts`(新規)

```ts
/** 選択中音声ソースの入力レベル(0〜1)を返す。取得不可・off時はnull */
export function useAudioLevel(audioSource: AudioSource, enabled: boolean): number | null
```

- `enabled=false`(WebP選択時など)または `audioSource === 'off'` → ストリームを開かず `null`
- `'system'` → `getDisplayMedia({ video: true, audio: true })` を取得し、映像トラックは即停止して音声のみ使う(既存recorder.tsのClean音声取得と同じパターン)
- deviceId → `getUserMedia({ audio: { deviceId: { exact: id } } })`
- 取得した音声トラックを `AudioContext` + `AnalyserNode` に接続し、`requestAnimationFrame` ループで `rmsLevel()` を計算してstateを更新
- クリーンアップ(audioSource変更・unmount): rAF停止、トラック停止、AudioContext close
- 取得失敗(権限なし・未接続)→ `null`。トラックの `ended` イベント(デバイス抜去)→ `null` に戻して非表示。再取得はaudioSource変更(選び直し)か再マウント時のみ
- レベル更新は毎フレームsetStateせず、前回値との差が小さいときはスキップして再レンダーを抑える

### UI — `src/renderer/src/components/VideoControls.tsx`

- Audio Selectの直下に高さ約6pxの水平バーを追加
- `useAudioLevel(audioSource, format === 'mp4')` の値で幅を0〜100%に伸縮。緑→黄→赤のグラデーション(`bg-gradient-to-r from-green-500 via-yellow-500 to-red-500` をレベル幅でクリップ)
- CSS transition(~100ms)で平滑化
- `level === null`(off・取得失敗・WebP)→ メーター自体を非表示
- 録画中も表示継続(プレビューストリームは録画ストリームと独立なのでそのまま動く)

### recorder.ts / Main側

変更なし。プレビューストリームは録画用ストリームと独立に開閉する(同一デバイスへの `getUserMedia` 並行取得、ループバックの並行セッションはどちらも可能)。

## エラーハンドリング

- システム音声: 画面収録権限なし → `getDisplayMedia` 拒否 → `null` → 非表示。権限の案内は既存の録画開始時トーストが担う
- デバイス: マイク権限拒否・未接続 → `null` → 非表示
- メーターの失敗が録画機能に影響する経路はない(完全に独立)

## テスト

- vitest: `audioLevel.test.ts` で `rmsLevel`(無音→0 / フルスケール→1 / 半振幅の既知値 / 空配列→0)をテスト
- 手動確認:
  - System audio選択 → 音楽再生でメーターが振れる
  - BlackHole等選択 → そのデバイスに流した音だけでメーターが振れる
  - Audio off / WebP選択 → メーター非表示
  - 録画中もメーターが動き続ける
  - デバイス取り外し → メーター非表示(エラーにならない)、画面収録権限なし環境でsystem選択 → 非表示
