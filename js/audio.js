/**
 * Rally - Web Audio Synthesizer
 * Zero-dependency acoustic chimes, tactile clicks, and alert tones generated via Web Audio API.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.isUnlocked = false;
  }

  /**
   * Initializes or resumes the AudioContext on user interaction
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
   * Warm harmonic acoustic chime for standard round/sprint completions (D5 -> A5 -> F#6)
   */
  playCompletionChime() {
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const frequencies = [587.33, 880.0, 1479.98];

    frequencies.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + index * 0.09);

      gain.gain.setValueAtTime(0.0001, now + index * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.22 / (index + 1), now + index * 0.09 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.09 + 1.5);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + index * 0.09);
      osc.stop(now + index * 0.09 + 1.55);
    });
  }

  /**
   * Piercing double buzzer for physical tasks and noisy environments
   */
  playBuzzer() {
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const pulses = [0, 0.2];

    pulses.forEach((offset) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now + offset);
      osc.frequency.setValueAtTime(330, now + offset + 0.08);

      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.linearRampToValueAtTime(0.25, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.16);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + offset);
      osc.stop(now + offset + 0.17);
    });
  }

  /**
   * Tactile click for UI actions and checkbox completions
   */
  playTactileClick() {
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(360, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.035);

    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.04);
  }
}

export const sound = new SoundEngine();
