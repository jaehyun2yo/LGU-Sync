import type { SoundPresetId } from '../../core/types/config.types'

interface SoundPreset {
  name: string
  play: (ctx: AudioContext, gain: GainNode) => void
}

function createOsc(
  ctx: AudioContext,
  gain: GainNode,
  type: OscillatorType,
  freq: number,
  startTime: number,
  duration: number,
): void {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, startTime)
  osc.connect(gain)
  osc.start(startTime)
  osc.stop(startTime + duration)
}

const PRESETS: Record<SoundPresetId, SoundPreset> = {
  default: {
    name: '기본음',
    play(ctx, gain) {
      createOsc(ctx, gain, 'sine', 523, ctx.currentTime, 0.15)
    },
  },
  chime: {
    name: '차임',
    play(ctx, gain) {
      const t = ctx.currentTime
      createOsc(ctx, gain, 'sine', 880, t, 0.1)
      createOsc(ctx, gain, 'sine', 1320, t + 0.1, 0.15)
    },
  },
  bell: {
    name: '벨',
    play(ctx, gain) {
      const t = ctx.currentTime
      createOsc(ctx, gain, 'triangle', 800, t, 0.2)
      createOsc(ctx, gain, 'triangle', 1600, t, 0.15)
    },
  },
  pop: {
    name: '팝',
    play(ctx, gain) {
      const t = ctx.currentTime
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(600, t)
      osc.frequency.exponentialRampToValueAtTime(200, t + 0.1)
      osc.connect(gain)
      osc.start(t)
      osc.stop(t + 0.1)
    },
  },
  ding: {
    name: '딩',
    play(ctx, gain) {
      createOsc(ctx, gain, 'sine', 1046, ctx.currentTime, 0.2)
    },
  },
}

class NotificationSoundPlayer {
  private ctx: AudioContext | null = null
  private volume = 0.7

  private getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext()
    }
    return this.ctx
  }

  setVolume(percent: number): void {
    this.volume = Math.max(0, Math.min(100, percent)) / 100
  }

  play(presetId: SoundPresetId): void {
    const preset = PRESETS[presetId]
    if (!preset) return
    const ctx = this.getContext()
    if (ctx.state === 'suspended') {
      ctx.resume()
    }
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(this.volume, ctx.currentTime)
    gain.connect(ctx.destination)
    preset.play(ctx, gain)
  }

  preview(presetId: SoundPresetId): void {
    this.play(presetId)
  }

  dispose(): void {
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close()
      this.ctx = null
    }
  }
}

export const soundPlayer = new NotificationSoundPlayer()
export const SOUND_PRESETS = PRESETS
