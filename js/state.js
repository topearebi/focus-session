/**
 * Rally - Reactive State Store & Persistence
 * Supports task editing, reordering, sound profiles, interval timing, and peer presence.
 */

const STORAGE_KEY = 'rally_state_v4';

const DEFAULT_STATE = {
  profile: {
    displayName: 'Player 1',
    avatarColor: '#38bdf8',
  },
  config: {
    sprintDurationSeconds: 25 * 60, // 1500s (25m)
    shortRestDurationSeconds: 5 * 60, // 300s (5m)
    longRestDurationSeconds: 15 * 60, // 900s (15m)
    roundsBeforeLongRest: 4,
    totalRounds: 4, // 0 = infinite continuous
    autoStartBreaks: true,
    autoStartSprints: false,
    timerDirection: 'countdown', // 'countdown' | 'countup'
    soundEnabled: true,
    soundProfile: 'warm', // 'warm' | 'crisp' | 'minimal'
  },
  session: {
    mode: 'sprint', // 'sprint' | 'shortRest' | 'longRest'
    status: 'idle', // 'idle' | 'running' | 'paused'
    currentRound: 1,
    remainingMs: 25 * 60 * 1000,
    totalDurationMs: 25 * 60 * 1000,
    targetTimestamp: null,
  },
  quest: {
    title: '',
    stones: [
      { id: 'stone-1', text: 'Define the game plan', completed: false },
      { id: 'stone-2', text: 'Execute step one', completed: false },
    ],
  },
  room: {
    roomId: null,
    isHost: false,
    connectionStatus: 'disconnected', // 'disconnected' | 'connecting' | 'connected'
    syncTimers: false,
    peers: {}, // peerId -> peerState
  },
};

class StateStore {
  constructor() {
    this.subscribers = new Set();
    this.state = this.loadState();
  }

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
        room: structuredClone(DEFAULT_STATE.room),
      };

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
          const elapsed = Date.now() - state.session.targetTimestamp;
          state.session.remainingMs = Math.max(0, elapsed);
        }
      }

      return state;
    } catch (e) {
      console.warn('Failed to parse local state, falling back to defaults:', e);
      return structuredClone(DEFAULT_STATE);
    }
  }

  persistState() {
    try {
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
      const ms = this.getDurationForMode(this.state.session.mode);
      this.state.session.totalDurationMs = ms;
      this.state.session.remainingMs = this.state.config.timerDirection === 'countup' ? 0 : ms;
    }
    this.notify();
  }

  getDurationForMode(mode) {
    switch (mode) {
      case 'shortRest':
        return Math.max(1, Math.round(this.state.config.shortRestDurationSeconds)) * 1000;
      case 'longRest':
        return Math.max(1, Math.round(this.state.config.longRestDurationSeconds)) * 1000;
      case 'sprint':
      default:
        return Math.max(1, Math.round(this.state.config.sprintDurationSeconds)) * 1000;
    }
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

  updateSteppingStone(id, newText) {
    const stone = this.state.quest.stones.find((s) => s.id === id);
    if (stone && newText && newText.trim()) {
      stone.text = newText.trim();
      this.notify();
    }
  }

  moveSteppingStone(id, direction) {
    const index = this.state.quest.stones.findIndex((s) => s.id === id);
    if (index === -1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= this.state.quest.stones.length) return;

    const stones = [...this.state.quest.stones];
    const [movedStone] = stones.splice(index, 1);
    stones.splice(targetIndex, 0, movedStone);

    this.state.quest.stones = stones;
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

  importSteppingStones(stones, newQuestTitle = null) {
    if (!Array.isArray(stones) || stones.length === 0) return;

    if (newQuestTitle && !this.state.quest.title) {
      this.state.quest.title = newQuestTitle;
    }

    const imported = stones.map((s, index) => ({
      id: `stone-import-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 5)}`,
      text: s.text,
      completed: false,
    }));

    this.state.quest.stones = imported;
    this.notify();
  }

  /* ================= Timer Session & Rounds Engine ================= */
  setMode(mode, roundOverride = null) {
    if (!['sprint', 'shortRest', 'longRest'].includes(mode)) return;

    const ms = this.getDurationForMode(mode);
    this.state.session.mode = mode;
    this.state.session.status = 'idle';
    this.state.session.totalDurationMs = ms;
    this.state.session.remainingMs = this.state.config.timerDirection === 'countup' ? 0 : ms;
    this.state.session.targetTimestamp = null;

    if (roundOverride !== null) {
      this.state.session.currentRound = roundOverride;
    }

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
    this.setMode('sprint', 1);
  }

  advanceSession() {
    const current = this.state.session.mode;
    const round = this.state.session.currentRound;
    const { roundsBeforeLongRest, autoStartBreaks, autoStartSprints } = this.state.config;

    let nextMode = 'sprint';
    let nextRound = round;
    let shouldAutoStart = false;

    if (current === 'sprint') {
      if (roundsBeforeLongRest > 0 && round % roundsBeforeLongRest === 0) {
        nextMode = 'longRest';
      } else {
        nextMode = 'shortRest';
      }
      shouldAutoStart = autoStartBreaks;
    } else {
      nextMode = 'sprint';
      nextRound = round + 1;
      shouldAutoStart = autoStartSprints;
    }

    this.setMode(nextMode, nextRound);

    if (shouldAutoStart) {
      this.startTimer();
    }

    return { nextMode, nextRound, shouldAutoStart };
  }

  /* ================= Shared Squad Room & Peers ================= */
  setRoomId(roomId, isHost = false) {
    this.state.room.roomId = roomId;
    this.state.room.isHost = isHost;
    if (!roomId) {
      this.state.room.peers = {};
      this.state.room.connectionStatus = 'disconnected';
    }
    this.notify();
  }

  setConnectionStatus(status) {
    this.state.room.connectionStatus = status;
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
