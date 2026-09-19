/**
 * Rally - Reactive State Store & Persistence
 * Manages timer state, Quests, Stepping Stones, user profile, and peer roster.
 */

const STORAGE_KEY = 'rally_state_v1';

const DEFAULT_STATE = {
  profile: {
    displayName: 'Player 1',
    avatarColor: '#38bdf8',
  },
  config: {
    sprintDurationMinutes: 25,
    restDurationMinutes: 5,
    timerDirection: 'countdown', // 'countdown' | 'countup'
    soundEnabled: true,
  },
  session: {
    mode: 'sprint', // 'sprint' | 'rest'
    status: 'idle', // 'idle' | 'running' | 'paused'
    remainingMs: 25 * 60 * 1000,
    totalDurationMs: 25 * 60 * 1000,
    targetTimestamp: null,
  },
  quest: {
    title: '',
    stones: [
      { id: 'stone-1', text: 'Define the game plan', completed: false },
      { id: 'stone-2', text: 'Execute step one', completed: false }
    ],
  },
  room: {
    roomId: null,
    isHost: false,
    syncTimers: false,
    peers: {}, // peerId -> peerState
  }
};

class StateStore {
  constructor() {
    this.subscribers = new Set();
    this.state = this.loadState();
  }

  /**
   * Loads state from localStorage and restores active countdown timestamps
   */
  loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_STATE);

      const parsed = JSON.parse(raw);
      const state = {
        profile: { ...DEFAULT_STATE.profile, ...parsed.profile },
        config: { ...DEFAULT_STATE.config, ...parsed.config },
        session: { ...DEFAULT_STATE.session, ...parsed.session },
        quest: { ...DEFAULT_STATE.quest, ...parsed.quest },
        room: structuredClone(DEFAULT_STATE.room), // Rooms are ephemeral per session
      };

      // Reconcile remaining time if it was running when reloaded
      if (state.session.status === 'running' && state.session.targetTimestamp) {
        if (state.config.timerDirection === 'countdown') {
          const remaining = state.session.targetTimestamp - Date.now();
          if (remaining > 0) {
            state.session.remainingMs = remaining;
          } else {
            state.session.remainingMs = 0;
            state.session.status = 'idle';
            state.session.targetTimestamp = null;
          }
        } else {
          // Count-up reconciliation
          const elapsed = Date.now() - state.session.targetTimestamp;
          state.session.remainingMs = Math.max(0, elapsed);
        }
      }

      return state;
    } catch (e) {
      console.warn('Failed to parse local state, restoring defaults:', e);
      return structuredClone(DEFAULT_STATE);
    }
  }

  persistState() {
    try {
      // Don't persist transient room peer connections to disk
      const toPersist = {
        profile: this.state.profile,
        config: this.state.config,
        session: this.state.session,
        quest: this.state.quest,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
    } catch (e) {
      console.error('Failed to commit state to localStorage:', e);
    }
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    callback(this.getState());
    return () => this.subscribers.delete(callback);
  }

  notify() {
    this.persistState();
    const snapshot = this.getState();
    for (const callback of this.subscribers) {
      callback(snapshot);
    }
  }

  getState() {
    return structuredClone(this.state);
  }

  /* ================= Profile & Preferences ================= */
  updateProfile(displayName, avatarColor) {
    if (displayName) this.state.profile.displayName = displayName.trim();
    if (avatarColor) this.state.profile.avatarColor = avatarColor;
    this.notify();
  }

  updateConfig(partialConfig) {
    this.state.config = { ...this.state.config, ...partialConfig };

    if (this.state.session.status === 'idle') {
      const mode = this.state.session.mode;
      const mins = mode === 'sprint' 
        ? this.state.config.sprintDurationMinutes 
        : this.state.config.restDurationMinutes;
      const ms = mins * 60 * 1000;

      this.state.session.totalDurationMs = ms;
      this.state.session.remainingMs = this.state.config.timerDirection === 'countup' ? 0 : ms;
    }
    this.notify();
  }

  /* ================= Current Quest & Stepping Stones ================= */
  setQuestTitle(title) {
    this.state.quest.title = title;
    this.notify();
  }

  addSteppingStone(text) {
    if (!text || !text.trim()) return;
    const newStone = {
      id: `stone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: text.trim(),
      completed: false,
    };
    this.state.quest.stones.push(newStone);
    this.notify();
  }

  toggleSteppingStone(id) {
    const stone = this.state.quest.stones.find((s) => s.id === id);
    if (stone) {
      stone.completed = !stone.completed;
      this.notify();
    }
  }

  deleteSteppingStone(id) {
    this.state.quest.stones = this.state.quest.stones.filter((s) => s.id !== id);
    this.notify();
  }

  /* ================= Timer Session Engine ================= */
  setMode(mode) {
    if (!['sprint', 'rest'].includes(mode)) return;

    const mins = mode === 'sprint' 
      ? this.state.config.sprintDurationMinutes 
      : this.state.config.restDurationMinutes;
    const ms = mins * 60 * 1000;

    this.state.session.mode = mode;
    this.state.session.status = 'idle';
    this.state.session.totalDurationMs = ms;
    this.state.session.remainingMs = this.state.config.timerDirection === 'countup' ? 0 : ms;
    this.state.session.targetTimestamp = null;

    this.notify();
  }

  updateRemaining(remainingMs) {
    this.state.session.remainingMs = remainingMs;
    this.notify();
  }

  startTimer() {
    this.state.session.status = 'running';
    if (this.state.config.timerDirection === 'countdown') {
      this.state.session.targetTimestamp = Date.now() + this.state.session.remainingMs;
    } else {
      // In count-up, anchor to starting point minus elapsed
      this.state.session.targetTimestamp = Date.now() - this.state.session.remainingMs;
    }
    this.notify();
  }

  pauseTimer() {
    this.state.session.status = 'paused';
    this.state.session.targetTimestamp = null;
    this.notify();
  }

  resetTimer() {
    this.setMode(this.state.session.mode);
  }

  advanceSession() {
    const nextMode = this.state.session.mode === 'sprint' ? 'rest' : 'sprint';
    this.setMode(nextMode);
  }

  /* ================= Shared Squad Room & Peers ================= */
  setRoomId(roomId, isHost = false) {
    this.state.room.roomId = roomId;
    this.state.room.isHost = isHost;
    if (!roomId) {
      this.state.room.peers = {};
    }
    this.notify();
  }

  setSyncTimers(enabled) {
    this.state.room.syncTimers = enabled;
    this.notify();
  }

  updatePeer(peerId, peerData) {
    this.state.room.peers[peerId] = {
      ...this.state.room.peers[peerId],
      ...peerData,
      lastSeen: Date.now(),
    };
    this.notify();
  }

  removePeer(peerId) {
    if (this.state.room.peers[peerId]) {
      delete this.state.room.peers[peerId];
      this.notify();
    }
  }
}

export const store = new StateStore();
