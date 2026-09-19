/**
 * Rally - Application Bootstrap & Orchestrator
 * Connects worker lifecycle, distinct audio transitions, P2P coordination, and Wake Lock.
 */

import { store } from './state.js';
import { ui } from './ui.js';
import { sound } from './audio.js';
import { peerSync } from './peer-sync.js';

class Application {
  constructor() {
    this.worker = null;
    this.wakeLockSentinel = null;

    this.initWorker();
    this.bindDOMEvents();
    this.bindKeyboardShortcuts();
    this.subscribeToStore();
    this.checkRoomHash();
    this.registerServiceWorker();
  }

  /**
   * Initializes the Web Worker for accurate background timing
   */
  initWorker() {
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

      this.worker.onmessage = (event) => {
        const { type, remainingMs } = event.data;

        if (type === 'TICK') {
          store.updateRemaining(remainingMs);
          peerSync.broadcast();
        } else if (type === 'COMPLETE') {
          this.handleSessionCompletion();
        }
      };
    } catch (err) {
      console.warn('Dedicated worker failed to load. Running local execution fallback:', err);
    }
  }

  /**
   * Dispatches phase-distinct audio cues and triggers auto-start transitions
   */
  handleSessionCompletion() {
    const previousState = store.getState();
    const previousMode = previousState.session.mode;

    // Advance session and calculate next phase and round
    const { nextMode, nextRound, shouldAutoStart } = store.advanceSession();
    const state = store.getState();

    // Trigger distinct acoustic cues based on the destination phase
    if (state.config.soundEnabled) {
      if (nextMode === 'longRest') {
        sound.playLongRestFanfare();
      } else if (nextMode === 'shortRest') {
        sound.playSprintComplete();
      } else if (nextMode === 'sprint') {
        sound.playRestComplete();
      }
    }

    ui.announce(`${ui.getModeLabel(previousMode)} completed. Now starting ${ui.getModeLabel(nextMode)}.`);

    if (!shouldAutoStart) {
      this.releaseWakeLock();
    }

    peerSync.broadcast();
  }

  /**
   * Subscribes UI and worker to state changes
   */
  subscribeToStore() {
    store.subscribe((state) => {
      ui.render(state);

      if (this.worker) {
        if (state.session.status === 'running') {
          this.worker.postMessage({
            command: 'START',
            remainingMs: state.session.remainingMs,
            targetTime: state.session.targetTimestamp,
            timerDirection: state.config.timerDirection,
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
   * Binds interactive DOM buttons, inputs, and modal controls
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
      peerSync.broadcast();
    });

    // Reset button
    const resetBtn = document.getElementById('reset-btn');
    resetBtn.addEventListener('click', () => {
      sound.playTactileClick();
      store.resetTimer();
      peerSync.broadcast();
    });

    // Skip button
    const skipBtn = document.getElementById('skip-btn');
    skipBtn.addEventListener('click', () => {
      sound.playTactileClick();
      this.handleSessionCompletion();
    });

    // Quest Title input
    const questInput = document.getElementById('quest-title-input');
    questInput.addEventListener('input', (e) => {
      store.setQuestTitle(e.target.value);
      peerSync.broadcast();
    });

    // Add Stepping Stone Form
    const addStoneForm = document.getElementById('add-stone-form');
    const newStoneInput = document.getElementById('new-stone-input');
    addStoneForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = newStoneInput.value.trim();
      if (text) {
        sound.playTactileClick();
        store.addSteppingStone(text);
        newStoneInput.value = '';
        peerSync.broadcast();
      }
    });

    // Settings Modal Open/Close triggers
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

    // Settings Form Submission
    settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sound.playTactileClick();

      const displayName = document.getElementById('display-name-input').value.trim();

      // Compute total seconds for sprint
      const sprintM = parseFloat(document.getElementById('sprint-min').value) || 0;
      const sprintS = parseFloat(document.getElementById('sprint-sec').value) || 0;
      const totalSprintSec = Math.max(1, Math.round(sprintM * 60 + sprintS));

      // Compute total seconds for short rest
      const shortM = parseFloat(document.getElementById('short-rest-min').value) || 0;
      const shortS = parseFloat(document.getElementById('short-rest-sec').value) || 0;
      const totalShortSec = Math.max(1, Math.round(shortM * 60 + shortS));

      // Compute total seconds for long rest
      const longM = parseFloat(document.getElementById('long-rest-min').value) || 0;
      const longS = parseFloat(document.getElementById('long-rest-sec').value) || 0;
      const totalLongSec = Math.max(1, Math.round(longM * 60 + longS));

      const roundsBeforeLong = parseInt(document.getElementById('rounds-before-long').value, 10);
      const totalRounds = parseInt(document.getElementById('total-rounds').value, 10);
      const autoStartBreaks = document.getElementById('auto-start-breaks').checked;
      const autoStartSprints = document.getElementById('auto-start-sprints').checked;
      const direction = document.getElementById('timer-direction-select').value;
      const soundEnabled = document.getElementById('sound-toggle').checked;

      store.updateProfile(displayName);
      store.updateConfig({
        sprintDurationSeconds: totalSprintSec,
        shortRestDurationSeconds: totalShortSec,
        longRestDurationSeconds: totalLongSec,
        roundsBeforeLongRest: Math.max(1, roundsBeforeLong || 4),
        totalRounds: Math.max(0, isNaN(totalRounds) ? 4 : totalRounds),
        autoStartBreaks,
        autoStartSprints,
        timerDirection: direction,
        soundEnabled,
      });

      ui.closeSettings();
      peerSync.broadcast();
    });

    // Squad Room Modal & Sharing
    const roomBtn = document.getElementById('room-btn');
    const closeRoomBtn = document.getElementById('close-room-btn');
    const copyLinkBtn = document.getElementById('copy-link-btn');
    const leaveRoomBtn = document.getElementById('leave-room-btn');
    const syncModeToggle = document.getElementById('sync-mode-toggle');

    roomBtn.addEventListener('click', async () => {
      sound.playTactileClick();
      const currentRoom = store.getState().room.roomId;
      if (!currentRoom) {
        await peerSync.createRoom();
      }
      ui.openRoom();
    });

    closeRoomBtn.addEventListener('click', () => {
      sound.playTactileClick();
      ui.closeRoom();
    });

    copyLinkBtn.addEventListener('click', async () => {
      sound.playTactileClick();
      const shareInput = document.getElementById('share-link-input');
      try {
        await navigator.clipboard.writeText(shareInput.value);
        copyLinkBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyLinkBtn.textContent = 'Copy';
        }, 2000);
      } catch {
        shareInput.select();
        document.execCommand('copy');
      }
    });

    leaveRoomBtn.addEventListener('click', () => {
      sound.playTactileClick();
      peerSync.leaveRoom();
      ui.closeRoom();
    });

    syncModeToggle.addEventListener('change', (e) => {
      store.setSyncTimers(e.target.checked);
      peerSync.broadcast();
    });
  }

  /**
   * Auto-joins a room if a room hash parameter is present in the URL
   */
  async checkRoomHash() {
    const hash = window.location.hash;
    const match = hash.match(/room=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      const targetRoom = match[1];
      try {
        await peerSync.joinRoom(targetRoom);
      } catch (err) {
        console.warn('Could not auto-join room from URL hash:', err);
      }
    }
  }

  /**
   * Global keyboard navigation & shortcuts
   */
  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
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
        peerSync.broadcast();
      } else if (e.code === 'KeyR' && e.altKey) {
        e.preventDefault();
        store.resetTimer();
        peerSync.broadcast();
      } else if (e.code === 'KeyS' && e.altKey) {
        e.preventDefault();
        this.handleSessionCompletion();
      }
    });
  }

  /**
   * Screen Wake Lock API management
   */
  async requestWakeLock() {
    if ('wakeLock' in navigator && !this.wakeLockSentinel) {
      try {
        this.wakeLockSentinel = await navigator.wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          this.wakeLockSentinel = null;
        });
      } catch (err) {
        console.info('Wake lock request denied:', err);
      }
    }
  }

  releaseWakeLock() {
    if (this.wakeLockSentinel) {
      this.wakeLockSentinel.release();
      this.wakeLockSentinel = null;
    }
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('./sw.js', { scope: './' })
          .catch((err) => console.warn('Service worker registration failed:', err));
      });
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new Application();
});
