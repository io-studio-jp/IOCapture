# 品質向上機能 — モーションブラー/SSAA/色空間タグ/PNG DPI

日付: 2026-06-12
ステータス: 設計

## 背景

Render/Liveモード再編(2026-06-11)で「任意解像度・固定fps保証」の基盤が完成した。
本設計はその上に乗る画質向上機能群。ユーザー選定: (1)モーションブラー+SSAA、
(2)色空間タグ+PNG DPI埋め込み。

## 1. モーションブラー（サブフレームレンダリング・Render専用）

仮想時計を1フレーム内でさらに分割して複数回撮影し、平均合成して1フレームにする。
速い動きが実写カメラのような自然なブラーになる。

- **UI**: VideoのRender選択時に「Motion blur: Off / 2x / 4x / 8x」(サンプル数)。
  デフォルトOff。prefs `renderBlurSamples?: 1 | 2 | 4 | 8`(1=Off)
- **シャッター角は180°固定**(映画の標準。1フレーム間隔の前半だけを露光=サンプル平均し、
  後半は撮影せず時間だけ進める)。コードに定数+コメントで明記
- **合成**: 各サンプルのBGRAバッファをUint32Arrayに加算し、サンプル数で除算して
  Uint8にする純関数 `accumulateFrames` / `averageFrames`(shared/、TDD)
- **ループへの組込み**(renderRecorder):
  ```
  for each フレーム:
    for s in 1..N: step(frameMs * 0.5 / N) → capturePage → 加算
    step(frameMs * 0.5)  // シャッター閉(撮影なし)
    平均 → (SSAA縮小) → ffmpegへ
  ```
  N=1(Off)のときは従来どおり step(frameMs) → 1枚撮影(分岐を最小に)
- **コスト**: レンダリング時間が約N倍。進捗表示は出力フレーム基準のまま

## 2. スーパーサンプリング（SSAA・Render/Still共通）

ターゲットの2倍の物理解像度でレンダリングし、高品質縮小(quality:'best')して出力する。
アンチエイリアスの無いcanvas/WebGL作品のジャギーが消える。

- **UI**: Still/Videoの両セクションに「Supersample 2x」トグル。デフォルトOff。
  prefs `stillSupersample?: boolean` / `renderSupersample?: boolean`
- **実装**: 撮影サーフェスをターゲットの2倍で確保(`acquireCaptureSurface(target*2)`)、
  各フレーム(静止画は1枚)を撮影後に `resize(target, 'best')`
- **上限処理**: 2倍後のサイズを `capToGpuLimit`(16384px)でキャップ。キャップされた場合は
  そのサイズで描画して縮小する(部分的なSSAAになるだけで破綻しない)。純関数
  `planSupersample(target, enabled): { renderSize, note? }`(shared/、TDD)
- **モーションブラーとの併用順**: 2倍解像度で加算平均 → 最後に1回だけ縮小(品質最良)

## 3. 色空間の明示（常時有効・UIなし）

現在の出力は色空間タグが無く、再生環境によって色解釈が揺れる。さらにffmpegの
RGB→YUV変換はデフォルトでBT.601系の行列が選ばれることがあり、HD解像度での再生
(BT.709前提)と組み合わさると彩度がわずかにずれる。

- **mp4(libx264)**: `-vf scale=in_range=full:out_range=tv:out_color_matrix=bt709` で
  変換行列を明示し、`-colorspace bt709 -color_primaries bt709 -color_trc bt709
  -color_range tv` でタグ付け
- **WebP**: 色空間タグの仕組みが無いためsRGB前提のまま(現状維持)
- **PNG(静止画)**: sRGBチャンク(+互換用gAMA 45455)を埋め込む。Electronの `toPNG()` は
  これらを含まないため、純関数 `annotatePng(png, opts)` でIHDR直後にチャンクを挿入する
  (CRC計算込み。shared/、TDD)

## 4. PNG DPI埋め込み（cm/dpi指定時）

Stillのcm/dpi指定で撮ったPNGに `pHYs` チャンク(pixels per meter = dpi / 0.0254)を
埋め込み、印刷ワークフローで実寸が通るようにする。

- `annotatePng` のオプション(`dpi?: number`)として実装(3と同じ挿入機構)
- StillControlsのcm/dpiモード時のみ `captureStill` の引数にdpiを渡す。px指定時は埋めない

## 実装メモ

- `annotatePng` はPNGシグネチャ+IHDR(先頭33バイト)の直後に sRGB/gAMA/pHYs を挿入。
  CRC32は自前実装(zlib不要、テーブル法)。既存チャンクの解析は不要(toPNG出力には
  これらのチャンクが無い前提だが、念のため既存sRGB/pHYsがあれば挿入をスキップ)
- ffmpeg引数の変更は `renderRecorder.ts`(mp4のみ)。Live(saveWebmAs)のmp4変換にも
  同じタグ付けを適用する
- 受け入れ: (a)ffprobeで color_space/primaries/transfer=bt709 を確認
  (b)pngcheck相当(自作スクリプト)でsRGB/pHYsチャンク確認 (c)ブラー有効時の出力で
  移動体に尾引きがあることを目視 (d)SSAA有効時のエッジ比較

## 受け入れ条件

1. Render(blur 4x + SSAA 2x)で4K60が完走し、フレーム数=秒数×60を維持
2. mp4にbt709タグが付き、変換行列が明示されている(ffprobe確認)
3. cm/dpi指定のPNGにpHYs(指定DPI±1)とsRGBチャンクが入る(px指定では pHYs 無し)
4. 全オプションOff時の出力は従来と同一品質(回帰なし)
