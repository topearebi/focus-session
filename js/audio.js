/**
 * Rally - Web Audio Synthesizer
 * Zero-dependency acoustic engine supporting Warm, Crisp, and Minimal sound profiles,
 * including interactive profile auditioning.
 */

import { store } from './state.js';

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.isUnlocked = false;
  }

  /**
   * Initializes or resumes AudioContext on user interaction
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

  getActiveProfile() {
    return store.getState().config.soundProfile || 'warm';
  }

  isSoundEnabled() {
    return store.getState().config.soundEnabled !== false;
  }

  /**
   * Schedules a shaped tone with envelope curves matched to the specified or active profile
   */
  scheduleTone(freq, start, duration, gainLevel = 0.2, typeOverride = null, profileOverride = null) {
    if (!this.ctx) return;

    const profile = profileOverride || this.getActiveProfile();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    let oscType = typeOverride || 'sine';
    let attackTime = 0.025;
    let actualGain = gainLevel;

    if (profile === 'crisp') {
      oscType = typeOverride || 'triangle';
      attackTime = 0.008; // Snappy, bright attack
      actualGain = gainLevel * 1.1;
    } else if (profile === 'minimal') {
      oscType = 'triangle';
      attackTime = 0.004; // Percussive woodblock strike
      actualGain = gainLevel * 0.85;
    }

    osc.type = oscType;
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(actualGain, start + attackTime);

    // Fast decay for minimal profile to avoid lingering ringing
    const decayDuration = profile === 'minimal' ? Math.min(duration, 0.12) : duration;
    gain.gain.exponentialRampToValueAtTime(0.0001, start + decayDuration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(start);
    osc.stop(start + decayDuration + 0.04);
  }

  /**
   * Plays a signature audition chime for the selected profile in settings
   */
  previewProfile(profileName) {
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    if (profileName === 'minimal') {
      // Woodblock double-tap preview
      this.scheduleTone(523.25, now, 0.08, 0.22, null, 'minimal');
      this.scheduleTone(659.25, now + 0.1, 0.1, 0.24, null, 'minimal');
      return;
    }

    if (profileName === 'crisp') {
      // Snappy arcade ascending preview
      this.scheduleTone(523.25, now, 0.18, 0.2, 'triangle', 'crisp');
      this.scheduleTone(783.99, now + 0.1, 0.4, 0.24, 'triangle', 'crisp');
      return;
    }

    // Default: Harmonic Warmth preview
    this.scheduleTone(523.25, now, 0.6, 0.2, 'sine', 'warm');
    this.scheduleTone(659.25, now + 0.12, 0.8, 0.22, 'sine', 'warm');
  }

  /**
   * Sprint / Focus Complete -> Relaxing downshift chord (F5 -> C5 -> A4)
   */
  playSprintComplete() {
    if (!this.isSoundEnabled()) return;
    this.initContext();
    if (!this.ctx) return;

    const profile = this.getActiveProfile();
    const now = this.ctx.currentTime;

    if (profile === 'minimal') {
      this.scheduleTone(523.25, now, 0.08, 0.2);
      this.scheduleTone(392.00, now + 0.12, 0.1, 0.22);
      return;
    }

    if (profile === 'crisp') {
      this.scheduleTone(698.46, now, 0.4, 0.22, 'triangle');
      this.scheduleTone(523.25, now + 0.1, 0.5, 0.20, 'triangle');
      this.scheduleTone(440.00, now + 0.2, 0.8, 0.25, 'sine');
      return;
    }

    // Default: Harmonic Warmth
    this.scheduleTone(698.46, now, 0.8, 0.22, 'sine');         // F5
    this.scheduleTone(523.25, now + 0.14, 0.9, 0.20, 'sine');  // C5
    this.scheduleTone(440.00, now + 0.30, 1.4, 0.25, 'sine');  // A4
  }

  /**
   * Rest Complete -> Energizing ascending triad (C5 -> E5 -> G5)
   */
  playRestComplete() {
    if (!this.isSoundEnabled()) return;
    this.initContext();
    if (!this.ctx) return;

    const profile = this.getActiveProfile();
    const now = this.ctx.currentTime;

    if (profile === 'minimal') {
      this.scheduleTone(440.00, now, 0.08, 0.2);
      this.scheduleTone(659.25, now + 0.1, 0.1, 0.24);
      return;
    }

    if (profile === 'crisp') {
      this.scheduleTone(523.25, now, 0.2, 0.20, 'triangle');
      this.scheduleTone(659.25, now + 0.08, 0.2, 0.22, 'triangle');
      this.scheduleTone(783.99, now + 0.16, 0.6, 0.26, 'sine');
      return;
    }

    // Default: Harmonic Warmth
    this.scheduleTone(523.25, now, 0.5, 0.18, 'triangle');
    this.scheduleTone(659.25, now + 0.12, 0.5, 0.20, 'triangle');
    this.scheduleTone(783.99, now + 0.24, 1.2, 0.25, 'sine');
  }

  /**
   * Long Rest Reached -> Celebratory harmonic major chord fanfare
   */
  playLongRestFanfare() {
    if (!this.isSoundEnabled()) return;
    this.initContext();
    if (!this.ctx) return;

    const profile = this.getActiveProfile();
    const now = this.ctx.currentTime;

    if (profile === 'minimal') {
      this.scheduleTone(523.25, now, 0.08, 0.2);
      this.scheduleTone(659.25, now + 0.09, 0.08, 0.22);
      this.scheduleTone(783.99, now + 0.18, 0.12, 0.24);
      return;
    }

    if (profile === 'crisp') {
      this.scheduleTone(523.25, now, 0.25, 0.18, 'triangle');
      this.scheduleTone(659.25, now + 0.08, 0.25, 0.20, 'triangle');
      this.scheduleTone(783.99, now + 0.16, 0.3, 0.22, 'triangle');
      this.scheduleTone(1046.50, now + 0.24, 1.0, 0.28, 'sine');
      return;
    }

    // Default: Harmonic Warmth
    this.scheduleTone(523.25, now, 0.6, 0.16, 'triangle');
    this.scheduleTone(659.25, now + 0.10, 0.6, 0.18, 'triangle');
    this.scheduleTone(783.99, now + 0.20, 0.7, 0.20, 'triangle');
    this.scheduleTone(1046.50, now + 0.32, 1.8, 0.26, 'sine');
    this.scheduleTone(261.63, now + 0.32, 1.6, 0.15, 'sine'); // Warm sub swell
  }

  /**
   * Tactile low-latency feedback for buttons and checklist interactions
   */
  playTactileClick() {
    if (!this.isSoundEnabled()) return;
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
   * Piercing double alert for loud environments
   */
  playBuzzer() {
    if (!this.isSoundEnabled()) return;
    this.initContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    [0, 0.2].forEach((offset) => {
      this.scheduleTone(440, now + offset, 0.16, 0.25, 'triangle');
    });
  }
}

export const sound = new SoundEngine();
