/**
 * Rally - Web Audio Synthesizer
 * Zero-dependency phase-distinct acoustic chimes, fanfares, and alerts.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.isUnlocked = false;
  }

  /**
   * Initializes or resumes the AudioContext on first user interaction
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
   * Helper: Plays a scheduled note with smooth exponential attack and decay
   */
  scheduleTone(freq, start, duration, gainLevel = 0.2, type = 'sine') {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainLevel, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  /**
   * Sprint / Focus Complete -> Relaxing descending chord (F5 -> C5 -> A4)
   * Signals that effort is over and calm downshifting begins.
   */
  playSprintComplete() {
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    this.scheduleTone(698.46, now, 0.8, 0.22, 'sine');         // F5
    this.scheduleTone(523.25, now + 0.14, 0.9, 0.20, 'sine');  // C5
    this.scheduleTone(440.00, now + 0.30, 1.4, 0.25, 'sine');  // A4
  }

  /**
   * Rest Complete -> Energizing ascending triad (C5 -> E5 -> G5)
   * Signals activation and return to focus.
   */
  playRestComplete() {
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    this.scheduleTone(523.25, now, 0.5, 0.18, 'triangle');        // C5
    this.scheduleTone(659.25, now + 0.12, 0.5, 0.20, 'triangle'); // E5
    this.scheduleTone(783.99, now + 0.24, 1.2, 0.25, 'sine');     // G5
  }

  /**
   * Long Rest Reached -> Celebratory harmonic major chord fanfare (C5 -> E5 -> G5 -> C6)
   * Acknowledges milestone completion across multiple rounds.
   */
  playLongRestFanfare() {
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    this.scheduleTone(523.25, now, 0.6, 0.16, 'triangle');        // C5
    this.scheduleTone(659.25, now + 0.10, 0.6, 0.18, 'triangle'); // E5
    this.scheduleTone(783.99, now + 0.20, 0.7, 0.20, 'triangle'); // G5
    this.scheduleTone(1046.50, now + 0.32, 1.8, 0.26, 'sine');    // C6
    // Ambient sub-bass swell
    this.scheduleTone(261.63, now + 0.32, 1.6, 0.15, 'sine');     // C4
  }

  /**
   * Tactile click for buttons and checklist progression
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

  /**
   * High-contrast piercing double alert for loud environments
   */
  playBuzzer() {
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    [0, 0.2].forEach((offset) => {
      this.scheduleTone(440, now + offset, 0.16, 0.25, 'triangle');
    });
  }
}

export const sound = new SoundEngine();
