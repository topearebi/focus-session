/**
 * Rally - Application Bootstrap & Orchestrator
 * Connects store subscriptions, worker communication, P2P room events, and Wake Lock.
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
   * Initializes the Web Worker to maintain accurate background countdown execution
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
    ui.announce(`${ui.getModeLabel(previousMode)} completed.`);

    this.releaseWakeLock();
    store.advanceSession();
    peerSync.broadcast();
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
      store.advanceSession();
      peerSync.broadcast();
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

    // Settings Modal
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

      const displayName = document.getElementById('display-name-input').value;
      const sprintMins = parseInt(document.getElementById('sprint-duration').value, 10);
      const restMins = parseInt(document.getElementById('rest-duration').value, 10);
      const direction = document.getElementById('timer-direction-select').value;
      const soundEnabled = document.getElementById('sound-toggle').checked;

      store.updateProfile(displayName);
      store.updateConfig({
        sprintDurationMinutes: Math.max(1, sprintMins || 25),
        restDurationMinutes: Math.max(1, restMins || 5),
        timerDirection: direction,
        soundEnabled,
      });

      ui.closeSettings();
      peerSync.broadcast();
    });

    // Room Modal & Collaboration
    const roomBtn = document.getElementById('room-btn');
    const closeRoomBtn = document.getElementById('close-room-btn');
    const copyLinkBtn = document.getElementById('copy-link-btn');
    const leaveRoomBtn = document.getElementById('leave-room-btn');
    const syncModeToggle = document.getElementById('sync-mode-toggle');

    roomBtn.addEventListener('click', async () => {
      sound.playTactileClick();
      const currentRoom = store.getState().room.roomId;
      if (!currentRoom) {
        // Auto-create room if clicking while solo
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
   * Auto-joins a room if a hash parameter is present in the URL
   */
  checkRoomHash() {
    const hash = window.location.hash;
    const match = hash.match(/room=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      const targetRoom = match[1];
      // Delay slightly to let PeerJS script initialize
      setTimeout(() => {
        peerSync.joinRoom(targetRoom).catch((err) => {
          console.warn('Could not auto-join room from hash:', err);
        });
      }, 500);
    }
  }

  /**
   * Registers global keyboard shortcuts
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
        store.advanceSession();
        peerSync.broadcast();
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

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new Application();
});
