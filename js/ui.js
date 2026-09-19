/**
 * Focus Session - UI Controller & DOM Orchestrator
 * Updates SVG progress rings, manages a11y milestones, synchronizes tab titles, and handles views.
 */

import { dynamicFavicon } from './favicon.js';

class UIController {
  constructor() {
    // DOM Elements
    this.html = document.documentElement;
    this.timerDisplay = document.getElementById('timer-display');
    this.sessionLabel = document.getElementById('session-mode-label');
    this.progressIndicator = document.getElementById('progress-indicator');
    this.primaryToggleBtn = document.getElementById('primary-toggle-btn');
    this.modeButtons = Array.from(document.querySelectorAll('.mode-btn'));
    this.cycleDots = Array.from(document.querySelectorAll('.cycle-dot'));
    this.a11yAnnouncer = document.getElementById('a11y-announcer');

    // Dialog elements
    this.dialog = document.getElementById('settings-dialog');
    this.focusDurationInput = document.getElementById('focus-duration');
    this.shortBreakInput = document.getElementById('short-break-duration');
    this.longBreakInput = document.getElementById('long-break-duration');
    this.autoStartCheckbox = document.getElementById('auto-start-toggle');
    this.soundCheckbox = document.getElementById('sound-toggle');

    // Circumference of SVG circle (r = 160 -> 2 * PI * 160 ≈ 1005.3)
    this.circumference = 2 * Math.PI * 160;
    this.lastAnnouncedMinute = null;
  }

  /**
   * Converts milliseconds into zero-padded mm:ss representation
   */
  formatTime(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  /**
   * Human-readable label by session mode
   */
  getModeTitle(mode) {
    switch (mode) {
      case 'shortBreak':
        return 'Short Break';
      case 'longBreak':
        return 'Long Break';
      case 'focus':
      default:
        return 'Deep Focus';
    }
  }

  /**
   * Dispatches accessibility messages to the screen-reader-only live region
   */
  announce(message) {
    if (this.a11yAnnouncer) {
      this.a11yAnnouncer.textContent = message;
    }
  }

  /**
   * Main render subscription callback invoked on any state mutation
   */
  render(state) {
    const { session, config } = state;
    const { mode, status, remainingMs, totalDurationMs, cycleIndex } = session;

    // 1. Update session mode tokens and styling
    this.html.setAttribute('data-session-mode', mode);
    this.sessionLabel.textContent = this.getModeTitle(mode);

    this.modeButtons.forEach((btn) => {
      const isCurrent = btn.dataset.mode === mode;
      btn.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
    });

    // 2. Render countdown time
    const timeFormatted = this.formatTime(remainingMs);
    this.timerDisplay.textContent = timeFormatted;

    // 3. Update primary toggle button state and semantics
    const isRunning = status === 'running';
    this.primaryToggleBtn.textContent = isRunning ? 'Pause' : 'Start';
    this.primaryToggleBtn.setAttribute(
      'aria-label',
      isRunning ? `Pause ${this.getModeTitle(mode)}` : `Start ${this.getModeTitle(mode)}`
    );

    // 4. Update SVG radial progress ring
    const elapsedRatio = totalDurationMs > 0 ? (totalDurationMs - remainingMs) / totalDurationMs : 0;
    const offset = this.circumference * (1 - Math.min(1, Math.max(0, elapsedRatio)));
    this.progressIndicator.style.strokeDashoffset = `${offset}px`;

    // 5. Update browser document title and dynamic favicon
    document.title = `${timeFormatted} • ${this.getModeTitle(mode)}`;
    dynamicFavicon.update(elapsedRatio, mode);

    // 6. Update cycle dots
    this.cycleDots.forEach((dot, idx) => {
      dot.setAttribute('data-active', idx <= cycleIndex ? 'true' : 'false');
    });

    // 7. Non-intrusive Accessibility milestones (Halfway, 1 minute, Complete)
    this.evaluateA11yMilestones(remainingMs, totalDurationMs, status, mode);

    // 8. Hydrate settings modal form values
    this.focusDurationInput.value = config.focusDurationMinutes;
    this.shortBreakInput.value = config.shortBreakDurationMinutes;
    this.longBreakInput.value = config.longBreakDurationMinutes;
    this.autoStartCheckbox.checked = config.autoStartBreaks;
    this.soundCheckbox.checked = config.soundEnabled;
  }

  /**
   * Announces relevant timing milestones without flooding screen readers every second
   */
  evaluateA11yMilestones(remainingMs, totalMs, status, mode) {
    if (status !== 'running') {
      this.lastAnnouncedMinute = null;
      return;
    }

    const currentMinute = Math.floor(remainingMs / 1000 / 60);

    if (this.lastAnnouncedMinute !== currentMinute) {
      if (remainingMs <= 60000 && remainingMs > 58000) {
        this.announce('One minute remaining.');
        this.lastAnnouncedMinute = currentMinute;
      } else if (
        Math.abs(remainingMs - totalMs / 2) < 2000 &&
        this.lastAnnouncedMinute !== 'halfway'
      ) {
        this.announce(`Halfway through ${this.getModeTitle(mode)}.`);
        this.lastAnnouncedMinute = 'halfway';
      }
    }
  }

  openSettings() {
    if (this.dialog && typeof this.dialog.showModal === 'function') {
      this.dialog.showModal();
    }
  }

  closeSettings() {
    if (this.dialog) {
      this.dialog.close();
    }
  }
}

export const ui = new UIController();
