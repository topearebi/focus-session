/**
 * Focus Session - Web Audio Synthesizer
 * Zero-dependency acoustic chimes generated via native Web Audio API oscillators.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.isUnlocked = false;
  }

  /**
   * Initializes or resumes the AudioContext on first user interaction.
   * Browsers block autoplay until an explicit user action occurs.
   */
  initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.isUnlocked = true;
  }

  /**
   * Plays a warm, resonant harmonic chime for session transitions.
   * Uses fundamental sine waves (D5 -> A5) with exponential gain decay.
   */
  playCompletionChime() {
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Harmonic tones (D5 = ~587.33Hz, A5 = 880Hz, F#6 = ~1479.98Hz)
    const frequencies = [587.33, 880.0, 1479.98];

    frequencies.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + index * 0.08);

      // Smooth attack and exponential decay to eliminate audio clicks
      gain.gain.setValueAtTime(0.0001, now + index * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.2 / (index + 1), now + index * 0.08 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.08 + 1.6);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + index * 0.08);
      osc.stop(now + index * 0.08 + 1.65);
    });
  }

  /**
   * Plays a subtle, tactile click sound for UI control feedback.
   */
  playTactileClick() {
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.04);

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.045);
  }
}

export const sound = new SoundEngine();
