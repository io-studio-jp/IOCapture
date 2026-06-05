/** 音声ソース指定。'off' | 'system' | それ以外は音声入力デバイスのdeviceId */
export type AudioSource = string

export const AUDIO_OFF = 'off'
export const AUDIO_SYSTEM = 'system'

/** prefsから初期音声ソースを解決する(旧recordAudio設定からの移行を含む) */
export function resolveAudioSource(prefs: {
  audioSource?: string
  recordAudio?: boolean
}): AudioSource {
  if (prefs.audioSource) return prefs.audioSource
  return prefs.recordAudio === false ? AUDIO_OFF : AUDIO_SYSTEM
}

/**
 * 列挙した音声入力デバイスと保存済み選択からSelect項目リストを作る。
 * 保存済みデバイスが列挙に無い場合(取り外し等)は「(not connected)」項目を末尾に追加し、
 * 選択状態を維持できるようにする。
 */
export function audioSourceOptions(
  devices: { deviceId: string; label: string }[],
  saved: { source: AudioSource; label?: string },
): { value: string; label: string }[] {
  const options = [
    { value: AUDIO_OFF, label: 'Audio off' },
    { value: AUDIO_SYSTEM, label: 'System audio' },
    ...devices.map((d) => ({ value: d.deviceId, label: d.label || 'Microphone' })),
  ]
  const isDevice = saved.source !== AUDIO_OFF && saved.source !== AUDIO_SYSTEM
  if (isDevice && !devices.some((d) => d.deviceId === saved.source)) {
    options.push({ value: saved.source, label: `${saved.label ?? 'Device'} (not connected)` })
  }
  return options
}
