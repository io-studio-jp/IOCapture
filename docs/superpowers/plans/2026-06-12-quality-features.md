# 品質向上機能 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** モーションブラー(サブフレーム合成)・SSAA(2倍描画→縮小)・色空間タグ(BT.709/sRGB)・PNG DPI埋め込みを追加する。

**Architecture:** 純ロジック(PNGチャンク挿入・フレーム加算平均・SSAAサイズ計画)をshared/にTDDで追加し、renderRecorderのフレームループとcapture.tsの静止画パスに組み込む。色空間タグはffmpeg引数とPNG後処理で常時有効。

**Tech Stack:** 既存スタック(Electron/vitest/ffmpeg-static)。新規依存なし。

**設計書:** `docs/superpowers/specs/2026-06-12-quality-features-design.md`

---

### Task 1: PNGチャンク挿入 `annotatePng` (TDD)

**Files:** Create `src/shared/png.ts` / Test `src/shared/png.test.ts`

- [ ] sRGB(intent 0)+gAMA(45455)を常時、`dpi`指定時はpHYs(ppm=round(dpi/0.0254), unit=1)を
      IHDR直後に挿入。CRC32はテーブル法で自前実装。既にsRGB/pHYsがあればスキップ
- [ ] テスト: 合成PNG(signature+IHDR+IDAT+IEND)に対し、(a)チャンク順序 (b)挿入チャンクの
      CRC再計算一致 (c)pHYs値(300dpi→11811ppm) (d)dpi未指定でpHYs無し (e)二重適用で増えない
- [ ] コミット: `feat: PNGにsRGB/gAMA/pHYsチャンクを埋め込むannotatePngを追加`

### Task 2: フレーム加算平均 (TDD)

**Files:** Create `src/shared/frameBlend.ts` / Test `src/shared/frameBlend.test.ts`

- [ ] `sumInto(acc: Uint32Array, frame: Buffer)` と `averageToBuffer(acc, count): Buffer`。
      テスト: 2枚平均・1枚パススルー・丸め
- [ ] コミット: `feat: モーションブラー用のフレーム加算平均を追加`

### Task 3: SSAAサイズ計画 (TDD)

**Files:** Create `src/shared/supersample.ts` / Test `src/shared/supersample.test.ts`

- [ ] `planSupersample(target, enabled): TargetSize` — enabled時は2倍をcapToGpuLimitで
      キャップして返す。テスト: 2倍/キャップ/Off時そのまま
- [ ] コミット: `feat: SSAAの描画サイズ計画を追加`

### Task 4: 型とprefs

**Files:** Modify `src/shared/ipc-types.ts`

- [ ] Prefs: `renderBlurSamples?: number` / `renderSupersample?: boolean` / `stillSupersample?: boolean`
- [ ] `StartRenderArgs` に `blurSamples: number` / `supersample: boolean`、
      `CaptureStillArgs`/`CaptureStillToArgs` に `supersample?: boolean` / `dpi?: number`
- [ ] コミット(Task5-7とまとめて可)

### Task 5: 静止画への組込み

**Files:** Modify `src/main/capture.ts`

- [ ] `capturePng(target, opts)`: `planSupersample`でrenderSizeを決め
      `withCaptureSurface(renderSize)`→target縮小(quality:'best')→`annotatePng(png, { dpi })`
- [ ] コミット: `feat: 静止画にSSAAとsRGB/DPIチャンク埋め込みを追加`

### Task 6: Renderループへの組込み

**Files:** Modify `src/main/renderRecorder.ts`

- [ ] サーフェスは `planSupersample(size, supersample)` で確保。フレームループ:
      blurSamples N>1 のとき シャッター180°=フレーム前半をN分割してstep+capture+加算、
      後半はstepのみ。平均→(SSAA時はresize 'best')→stride詰め→pipe。N=1は従来パス
- [ ] mp4エンコードに色空間明示:
      `-vf scale=in_range=full:out_range=tv:out_color_matrix=bt709` +
      `-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`
- [ ] コミット: `feat: Renderにモーションブラー/SSAA/BT.709タグを追加`

### Task 7: Live mp4変換の色タグ

**Files:** Modify `src/main/ffmpeg.ts`

- [ ] saveWebmAsのmp4分岐にタグのみ追加(`-colorspace bt709 -color_primaries bt709
      -color_trc bt709`)。入力は既にYUVなので行列変換は強制しない
- [ ] コミット: `feat: Live mp4変換にBT.709タグを追加`

### Task 8: UI

**Files:** Modify `src/renderer/src/components/VideoControls.tsx`, `StillControls.tsx`

- [ ] Video(Render時): Motion blur Off/2x/4x/8x ボタン行 + Supersample 2x トグル(prefs保存)
- [ ] Still: Supersample 2x トグル。cm/dpiモード時は `captureStill`/`captureStillTo` にdpiを渡す
- [ ] コミット: `feat: ブラー/SSAAのUIを追加`

### Task 9: 検証

- [ ] typecheck / vitest / build / check:preload / eslint(新規ファイル0警告)
- [ ] 受け入れハーネス: blur4x+SSAA2xの4K60×2秒 → ffprobe(解像度/fps/フレーム数 +
      color_space=bt709) + ブラー目視。captureStillToで300dpi PNG → チャンク検証
- [ ] manual-test-checklist更新 + 最終レビュー
