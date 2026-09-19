/**
 * Focus Session - Application Bootstrap & Orchestrator
 * Connects store subscriptions, worker communication, keyboard shortcuts, and Wake Lock.
 */

import { store } from './state.js';
import { ui } from './ui.js';
import { sound } from './audio.js';

class Application {
  constructor() {
    this.worker = null;
    this.wakeLockSentinel = null;

    this.initWorker();
    this.bindDOMEvents();
    this.bindKeyboardShortcuts();
    this.subscribeToStore();
    this.registerServiceWorker();
  }

  /**
   * Initializes the Web Worker to maintain accurate background countdown execution
   */
  initWorker() {
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

      this.worker.onmessage = (event) => {
        const { type, remainingMs } = event.data;

        if (type === 'TICK') {
          store.updateRemaining(remainingMs);
        } else if (type === 'COMPLETE') {
          this.handleSessionCompletion();
        }
      };
    } catch (err) {
      console.warn('Dedicated worker failed to load. Falling back to local timing:', err);
    }
  }

  /**
   * Dispatches audio feedback and triggers sequence advances on session completion
   */
  handleSessionCompletion() {
    const state = store.getState();
    if (state.config.soundEnabled) {
      sound.playCompletionChime();
    }

    const previousMode = state.session.mode;
    ui.announce(`${ui.getModeTitle(previousMode)} completed.`);

    this.releaseWakeLock();
    store.advanceSession();
  }

  /**
   * Subscribes the UI and background worker to reactive state changes
   */
  subscribeToStore() {
    store.subscribe((state) => {
      ui.render(state);

      // Synchronize state with worker commands
      if (this.worker) {
        if (state.session.status === 'running') {
          this.worker.postMessage({
            command: 'START',
            remainingMs: state.session.remainingMs,
            targetTime: state.session.targetTimestamp,
          });
          this.requestWakeLock();
        } else {
          this.worker.postMessage({ command: 'PAUSE' });
          this.releaseWakeLock();
        }
      }
    });
  }

  /**
   * Attaches event listeners to interactive DOM elements
   */
  bindDOMEvents() {
    // Primary Start / Pause button
    const toggleBtn = document.getElementById('primary-toggle-btn');
    toggleBtn.addEventListener('click', () => {
      sound.playTactileClick();
      const { status } = store.getState().session;
      if (status === 'running') {
        store.pauseTimer();
      } else {
        store.startTimer();
      }
    });

    // Reset button
    const resetBtn = document.getElementById('reset-btn');
    resetBtn.addEventListener('click', () => {
      sound.playTactileClick();
      store.resetTimer();
    });

    // Skip button
    const skipBtn = document.getElementById('skip-btn');
    skipBtn.addEventListener('click', () => {
      sound.playTactileClick();
      store.advanceSession();
    });

    // Mode switch buttons
    const modeButtons = document.querySelectorAll('.mode-btn');
    modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        sound.playTactileClick();
        const targetMode = btn.dataset.mode;
        store.setMode(targetMode);
      });
    });

    // Settings modal interactions
    const openSettingsBtn = document.getElementById('open-settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const settingsForm = document.getElementById('settings-form');

    openSettingsBtn.addEventListener('click', () => {
      sound.playTactileClick();
      ui.openSettings();
    });

    closeSettingsBtn.addEventListener('click', () => {
      sound.playTactileClick();
      ui.closeSettings();
    });

    settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      sound.playTactileClick();

      const focusMinutes = parseInt(document.getElementById('focus-duration').value, 10);
      const shortBreakMinutes = parseInt(document.getElementById('short-break-duration').value, 10);
      const longBreakMinutes = parseInt(document.getElementById('long-break-duration').value, 10);
      const autoStartBreaks = document.getElementById('auto-start-toggle').checked;
      const soundEnabled = document.getElementById('sound-toggle').checked;

      store.updateConfig({
        focusDurationMinutes: Math.max(1, focusMinutes || 25),
        shortBreakDurationMinutes: Math.max(1, shortBreakMinutes || 5),
        longBreakDurationMinutes: Math.max(1, longBreakMinutes || 15),
        autoStartBreaks,
        soundEnabled,
      });

      ui.closeSettings();
    });
  }

  /**
   * Registers global keyboard shortcuts for power-user navigation
   */
  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ignore key shortcuts if a text or number input is focused
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        const { status } = store.getState().session;
        if (status === 'running') {
          store.pauseTimer();
        } else {
          store.startTimer();
        }
      } else if (e.code === 'KeyR' && e.altKey) {
        e.preventDefault();
        store.resetTimer();
      } else if (e.code === 'KeyS' && e.altKey) {
        e.preventDefault();
        store.advanceSession();
      }
    });
  }

  /**
   * Manages Screen Wake Lock API to prevent screens from sleeping during active sessions
   */
  async requestWakeLock() {
    if ('wakeLock' in navigator && !this.wakeLockSentinel) {
      try {
        this.wakeLockSentinel = await navigator.wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          this.wakeLockSentinel = null;
        });
      } catch (err) {
        // May fail if battery saver is on or user switches away
        console.info('Screen Wake Lock could not be obtained:', err);
      }
    }
  }

  releaseWakeLock() {
    if (this.wakeLockSentinel) {
      this.wakeLockSentinel.release();
      this.wakeLockSentinel = null;
    }
  }

  /**
   * Registers Service Worker for offline-first resilience
   */
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('./sw.js', { scope: './' })
          .catch((err) => console.warn('ServiceWorker registration failed:', err));
      });
    }
  }
}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new Application();
});
