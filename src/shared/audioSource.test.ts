import { describe, it, expect } from 'vitest'
import { AUDIO_OFF, AUDIO_SYSTEM, resolveAudioSource, audioSourceOptions } from './audioSource'

describe('resolveAudioSource', () => {
  it('audioSourceがあればそれを返す', () => {
    expect(resolveAudioSource({ audioSource: 'device-123', recordAudio: false })).toBe('device-123')
    expect(resolveAudioSource({ audioSource: AUDIO_OFF })).toBe(AUDIO_OFF)
  })
  it('audioSourceがなくrecordAudio=falseならoff(旧設定からの移行)', () => {
    expect(resolveAudioSource({ recordAudio: false })).toBe(AUDIO_OFF)
  })
  it('どちらもなければsystem', () => {
    expect(resolveAudioSource({})).toBe(AUDIO_SYSTEM)
    expect(resolveAudioSource({ recordAudio: true })).toBe(AUDIO_SYSTEM)
  })
})

describe('audioSourceOptions', () => {
  it('デバイスなしでもoff/systemの2項目を返す', () => {
    expect(audioSourceOptions([], { source: AUDIO_SYSTEM })).toEqual([
      { value: 'off', label: 'Audio off' },
      { value: 'system', label: 'System audio' },
    ])
  })
  it('列挙デバイスを項目に含める', () => {
    const opts = audioSourceOptions(
      [{ deviceId: 'bh-1', label: 'BlackHole 2ch' }],
      { source: AUDIO_SYSTEM },
    )
    expect(opts).toContainEqual({ value: 'bh-1', label: 'BlackHole 2ch' })
  })
  it('labelが空のデバイスはMicrophoneにフォールバック', () => {
    const opts = audioSourceOptions([{ deviceId: 'd-1', label: '' }], { source: AUDIO_SYSTEM })
    expect(opts).toContainEqual({ value: 'd-1', label: 'Microphone' })
  })
  it('保存済みデバイスが列挙に無ければ (not connected) 項目を末尾に追加', () => {
    const opts = audioSourceOptions([], { source: 'gone-1', label: 'Rubix24' })
    expect(opts[opts.length - 1]).toEqual({ value: 'gone-1', label: 'Rubix24 (not connected)' })
  })
  it('保存済みがoff/systemや列挙済みデバイスなら追加しない', () => {
    expect(audioSourceOptions([], { source: AUDIO_OFF })).toHaveLength(2)
    const opts = audioSourceOptions(
      [{ deviceId: 'bh-1', label: 'BlackHole 2ch' }],
      { source: 'bh-1', label: 'BlackHole 2ch' },
    )
    expect(opts).toHaveLength(3)
  })
})
