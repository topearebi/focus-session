/**
 * Focus Session - State Management & Persistence Store
 * Schema definition, reactive subscriber bus, and localStorage synchronization.
 */

const STORAGE_KEY = 'focus_session_state_v2';

/**
 * Default fallback configuration & state schema
 */
const DEFAULT_STATE = {
  config: {
    focusDurationMinutes: 25,
    shortBreakDurationMinutes: 5,
    longBreakDurationMinutes: 15,
    autoStartBreaks: false,
    soundEnabled: true,
  },
  session: {
    mode: 'focus', // 'focus' | 'shortBreak' | 'longBreak'
    status: 'idle', // 'idle' | 'running' | 'paused'
    remainingMs: 25 * 60 * 1000,
    totalDurationMs: 25 * 60 * 1000,
    targetTimestamp: null,
    cycleIndex: 0, // 0 to 3 (4 intervals per round)
  },
};

class StateStore {
  constructor() {
    this.subscribers = new Set();
    this.state = this.loadState();
  }

  /**
   * Load persisted state from localStorage and reconcile timestamp deltas.
   * Ensures uninterrupted tracking if the tab is reloaded or temporarily closed.
   */
  loadState() {
    try {
      const serialized = localStorage.getItem(STORAGE_KEY);
      if (!serialized) {
        return structuredClone(DEFAULT_STATE);
      }

      const parsed = JSON.parse(serialized);
      const state = {
        config: { ...DEFAULT_STATE.config, ...parsed.config },
        session: { ...DEFAULT_STATE.session, ...parsed.session },
      };

      // Reconcile time if active countdown was preserved
      if (state.session.status === 'running' && state.session.targetTimestamp) {
        const remaining = state.session.targetTimestamp - Date.now();
        if (remaining > 0) {
          state.session.remainingMs = remaining;
        } else {
          // Time expired while page was closed
          state.session.remainingMs = 0;
          state.session.status = 'idle';
          state.session.targetTimestamp = null;
        }
      }

      return state;
    } catch (e) {
      console.warn('Failed to parse persisted state. Resetting to defaults.', e);
      return structuredClone(DEFAULT_STATE);
    }
  }

  /**
   * Commit state mutations to localStorage
   */
  persistState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('Storage quota exceeded or private mode restriction:', e);
    }
  }

  /**
   * Subscribe a callback to state updates
   * @param {Function} callback - Invoked with (currentState) on every mutation
   * @returns {Function} Unsubscribe method
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    // Initial emit for hydration
    callback(this.getState());
    return () => this.subscribers.delete(callback);
  }

  /**
   * Broadcast state changes to all subscribers
   */
  notify() {
    this.persistState();
    const currentState = this.getState();
    for (const callback of this.subscribers) {
      callback(currentState);
    }
  }

  /**
   * Return an immutable snapshot of current state
   */
  getState() {
    return structuredClone(this.state);
  }

  /**
   * Update configuration preferences
   */
  updateConfig(partialConfig) {
    this.state.config = { ...this.state.config, ...partialConfig };

    // If currently idle, adjust active session duration to match new config
    if (this.state.session.status === 'idle') {
      const mode = this.state.session.mode;
      const durationKey = `${mode}DurationMinutes`;
      const durationMinutes = this.state.config[durationKey] || DEFAULT_STATE.config.focusDurationMinutes;
      const durationMs = durationMinutes * 60 * 1000;

      this.state.session.totalDurationMs = durationMs;
      this.state.session.remainingMs = durationMs;
    }

    this.notify();
  }

  /**
   * Transition session mode (focus, shortBreak, longBreak)
   */
  setMode(mode) {
    if (!['focus', 'shortBreak', 'longBreak'].includes(mode)) return;

    let minutes = this.state.config.focusDurationMinutes;
    if (mode === 'shortBreak') minutes = this.state.config.shortBreakDurationMinutes;
    if (mode === 'longBreak') minutes = this.state.config.longBreakDurationMinutes;

    const durationMs = minutes * 60 * 1000;

    this.state.session.mode = mode;
    this.state.session.status = 'idle';
    this.state.session.remainingMs = durationMs;
    this.state.session.totalDurationMs = durationMs;
    this.state.session.targetTimestamp = null;

    this.notify();
  }

  /**
   * Mutate session timer metrics during active countdown
   */
  updateRemaining(remainingMs) {
    this.state.session.remainingMs = Math.max(0, remainingMs);
    this.notify();
  }

  /**
   * Start or resume current timer session
   */
  startTimer() {
    this.state.session.status = 'running';
    this.state.session.targetTimestamp = Date.now() + this.state.session.remainingMs;
    this.notify();
  }

  /**
   * Pause current timer session
   */
  pauseTimer() {
    this.state.session.status = 'paused';
    this.state.session.targetTimestamp = null;
    this.notify();
  }

  /**
   * Reset session back to duration configured for current mode
   */
  resetTimer() {
    this.setMode(this.state.session.mode);
  }

  /**
   * Transition to next sequence step upon interval completion or manual skip
   */
  advanceSession() {
    const currentMode = this.state.session.mode;
    let nextMode = 'focus';
    let nextCycle = this.state.session.cycleIndex;

    if (currentMode === 'focus') {
      nextCycle = (nextCycle + 1) % 4;
      // Every 4 focus intervals trigger a Long Break
      nextMode = nextCycle === 0 ? 'longBreak' : 'shortBreak';
    } else {
      nextMode = 'focus';
    }

    this.state.session.cycleIndex = nextCycle;
    this.setMode(nextMode);

    // Auto-start breaks or focus if enabled in user config
    const shouldAutoStart = 
      (nextMode.includes('Break') && this.state.config.autoStartBreaks);

    if (shouldAutoStart) {
      this.startTimer();
    }
  }
}

export const store = new StateStore();
