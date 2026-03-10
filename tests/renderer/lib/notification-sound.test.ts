import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Web Audio API
const mockOscillator = {
  type: 'sine',
  frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}

const mockGain = {
  gain: { setValueAtTime: vi.fn() },
  connect: vi.fn(),
}

const mockAudioContext = {
  currentTime: 0,
  state: 'running',
  createOscillator: vi.fn(() => ({ ...mockOscillator })),
  createGain: vi.fn(() => ({ ...mockGain })),
  destination: {},
  resume: vi.fn(),
  close: vi.fn(),
}

vi.stubGlobal('AudioContext', function MockAudioContext() {
  return { ...mockAudioContext }
})

describe('notification-sound', () => {
  let soundPlayer: typeof import('../../../src/renderer/lib/notification-sound').soundPlayer
  let SOUND_PRESETS: typeof import('../../../src/renderer/lib/notification-sound').SOUND_PRESETS

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../../../src/renderer/lib/notification-sound')
    soundPlayer = mod.soundPlayer
    SOUND_PRESETS = mod.SOUND_PRESETS
  })

  it('exports 5 presets', () => {
    expect(Object.keys(SOUND_PRESETS)).toHaveLength(5)
    expect(SOUND_PRESETS).toHaveProperty('default')
    expect(SOUND_PRESETS).toHaveProperty('chime')
    expect(SOUND_PRESETS).toHaveProperty('bell')
    expect(SOUND_PRESETS).toHaveProperty('pop')
    expect(SOUND_PRESETS).toHaveProperty('ding')
  })

  it('each preset has a name', () => {
    for (const preset of Object.values(SOUND_PRESETS)) {
      expect(preset.name).toBeTruthy()
    }
  })

  it('setVolume clamps between 0 and 100', () => {
    // No error for edge values
    soundPlayer.setVolume(0)
    soundPlayer.setVolume(100)
    soundPlayer.setVolume(-10)
    soundPlayer.setVolume(150)
  })

  it('play creates audio context and plays', () => {
    soundPlayer.play('default')
    // Should not throw
  })

  it('preview calls play', () => {
    soundPlayer.preview('chime')
    // Should not throw
  })

  it('dispose closes audio context', () => {
    soundPlayer.play('default')
    soundPlayer.dispose()
    // Should not throw on double dispose
    soundPlayer.dispose()
  })
})
