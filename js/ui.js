/**
 * Rally - UI Controller & DOM Orchestrator
 * Updates radial progress, renders Quest checklists, updates peer squad cards, and synchronizes modals.
 */

import { dynamicFavicon } from './favicon.js';
import { store } from './state.js';

class UIController {
  constructor() {
    this.html = document.documentElement;

    // Header & Room elements
    this.roomBtn = document.getElementById('room-btn');
    this.roomStatusIndicator = document.getElementById('room-status-indicator');

    // Timer elements
    this.timerDisplay = document.getElementById('timer-display');
    this.sessionModeBadge = document.getElementById('session-mode-badge');
    this.progressIndicator = document.getElementById('progress-indicator');
    this.primaryToggleBtn = document.getElementById('primary-toggle-btn');
    this.a11yAnnouncer = document.getElementById('a11y-announcer');

    // Quest & Stepping Stone elements
    this.questTitleInput = document.getElementById('quest-title-input');
    this.stonesCounter = document.getElementById('stones-counter');
    this.steppingStonesList = document.getElementById('stepping-stones-list');

    // Peer Grid elements
    this.peerSection = document.getElementById('peer-section');
    this.peerGrid = document.getElementById('peer-grid');

    // Settings Modal elements
    this.settingsDialog = document.getElementById('settings-dialog');
    this.displayNameInput = document.getElementById('display-name-input');
    this.sprintDurationInput = document.getElementById('sprint-duration');
    this.restDurationInput = document.getElementById('rest-duration');
    this.timerDirectionSelect = document.getElementById('timer-direction-select');
    this.soundToggle = document.getElementById('sound-toggle');

    // Room Modal elements
    this.roomDialog = document.getElementById('room-dialog');
    this.syncModeToggle = document.getElementById('sync-mode-toggle');
    this.shareLinkInput = document.getElementById('share-link-input');

    // SVG radial progress setup (r = 150 -> 2 * PI * 150 ≈ 942.48)
    this.circumference = 2 * Math.PI * 150;
    this.lastAnnouncedMinute = null;
  }

  /**
   * Formats milliseconds into zero-padded mm:ss representation
   */
  formatTime(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  getModeLabel(mode) {
    switch (mode) {
      case 'rest':
        return 'Rest / Reset';
      case 'sprint':
      default:
        return 'Sprint';
    }
  }

  announce(message) {
    if (this.a11yAnnouncer) {
      this.a11yAnnouncer.textContent = message;
    }
  }

  /**
   * Main render method invoked on any state change
   */
  render(state) {
    const { session, config, quest, room, profile } = state;
    const { mode, status, remainingMs, totalDurationMs } = session;

    // 1. Update theme and mode pill
    this.html.setAttribute('data-theme-mode', mode);
    this.sessionModeBadge.textContent = this.getModeLabel(mode);

    // 2. Render countdown / count-up readout
    const timeFormatted = this.formatTime(remainingMs);
    this.timerDisplay.textContent = timeFormatted;

    // 3. Update primary toggle button state
    const isRunning = status === 'running';
    this.primaryToggleBtn.textContent = isRunning ? 'Pause' : 'Start';
    this.primaryToggleBtn.setAttribute(
      'aria-label',
      isRunning ? `Pause ${this.getModeLabel(mode)}` : `Start ${this.getModeLabel(mode)}`
    );

    // 4. Update SVG radial dial indicator
    const elapsedRatio = totalDurationMs > 0 ? (totalDurationMs - remainingMs) / totalDurationMs : 0;
    const normalizedRatio = config.timerDirection === 'countup' 
      ? 1 
      : Math.min(1, Math.max(0, elapsedRatio));
    const offset = this.circumference * (1 - normalizedRatio);
    this.progressIndicator.style.strokeDashoffset = `${offset}px`;

    // 5. Update browser title and dynamic favicon
    document.title = `${timeFormatted} • Rally`;
    dynamicFavicon.update(normalizedRatio, mode);

    // 6. Update Current Quest and Stepping Stones
    if (document.activeElement !== this.questTitleInput) {
      this.questTitleInput.value = quest.title;
    }
    this.renderSteppingStones(quest.stones);

    // 7. Update Room Status & Peers
    this.renderRoomStatus(room);
    this.renderPeerGrid(room.peers);

    // 8. Hydrate Dialog Inputs
    if (document.activeElement !== this.displayNameInput) {
      this.displayNameInput.value = profile.displayName;
    }
    this.sprintDurationInput.value = config.sprintDurationMinutes;
    this.restDurationInput.value = config.restDurationMinutes;
    this.timerDirectionSelect.value = config.timerDirection;
    this.soundToggle.checked = config.soundEnabled;
    this.syncModeToggle.checked = room.syncTimers;

    // 9. Accessibility Milestones
    this.evaluateA11yMilestones(remainingMs, totalDurationMs, status, mode);
  }

  /**
   * Renders the stepping stones checklist
   */
  renderSteppingStones(stones) {
    const completedCount = stones.filter((s) => s.completed).length;
    this.stonesCounter.textContent = `${completedCount} / ${stones.length}`;

    this.steppingStonesList.innerHTML = '';

    stones.forEach((stone) => {
      const li = document.createElement('li');
      li.className = 'stone-item';
      li.setAttribute('data-completed', stone.completed ? 'true' : 'false');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'stone-checkbox';
      checkbox.checked = stone.completed;
      checkbox.setAttribute('aria-label', `Mark "${stone.text}" as complete`);
      checkbox.addEventListener('change', () => store.toggleSteppingStone(stone.id));

      const span = document.createElement('span');
      span.className = 'stone-text';
      span.textContent = stone.text;

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'stone-delete-btn';
      deleteBtn.setAttribute('aria-label', `Delete "${stone.text}"`);
      deleteBtn.innerHTML = '&times;';
      deleteBtn.addEventListener('click', () => store.deleteSteppingStone(stone.id));

      li.appendChild(checkbox);
      li.appendChild(span);
      li.appendChild(deleteBtn);
      this.steppingStonesList.appendChild(li);
    });
  }

  /**
   * Updates the top bar room connection indicator
   */
  renderRoomStatus(room) {
    if (room.roomId) {
      const peerCount = Object.keys(room.peers).length + 1;
      this.roomBtn.setAttribute('data-connected', 'true');
      this.roomStatusIndicator.textContent = `👥 ${peerCount} in Room`;
      this.shareLinkInput.value = `${window.location.origin}${window.location.pathname}#room=${room.roomId}`;
    } else {
      this.roomBtn.setAttribute('data-connected', 'false');
      this.roomStatusIndicator.textContent = '👥 Solo';
      this.shareLinkInput.value = '';
    }
  }

  /**
   * Renders the Body Doubling squad cards
   */
  renderPeerGrid(peers) {
    const peerEntries = Object.entries(peers);

    if (peerEntries.length === 0) {
      this.peerSection.style.display = 'none';
      this.peerGrid.innerHTML = '';
      return;
    }

    this.peerSection.style.display = 'flex';
    this.peerGrid.innerHTML = '';

    peerEntries.forEach(([peerId, data]) => {
      const card = document.createElement('article');
      card.className = 'peer-card';
      card.style.setProperty('--peer-accent', data.avatarColor || '#38bdf8');

      const progressPercent = data.quest?.totalStones > 0
        ? Math.round((data.quest.completedStones / data.quest.totalStones) * 100)
        : 0;

      card.innerHTML = `
        <div class="peer-card-header">
          <span class="peer-name">${this.escapeHtml(data.displayName || 'Teammate')}</span>
          <span class="peer-timer numeric-tabular">${this.formatTime(data.timer?.remainingMs || 0)}</span>
        </div>
        <div class="peer-quest">${this.escapeHtml(data.quest?.title || 'No Quest set')}</div>
        <div class="peer-active-stone">${this.escapeHtml(data.quest?.activeStone || 'Idle')}</div>
        <div class="peer-progress-bar">
          <div class="peer-progress-fill" style="width: ${progressPercent}%;"></div>
        </div>
      `;

      this.peerGrid.appendChild(card);
    });
  }

  evaluateA11yMilestones(remainingMs, totalMs, status, mode) {
    if (status !== 'running') {
      this.lastAnnouncedMinute = null;
      return;
    }

    const currentMinute = Math.floor(remainingMs / 1000 / 60);

    if (this.lastAnnouncedMinute !== currentMinute) {
      if (remainingMs <= 60000 && remainingMs > 58000) {
        this.announce('One minute remaining in session.');
        this.lastAnnouncedMinute = currentMinute;
      }
    }
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  openSettings() {
    if (this.settingsDialog?.showModal) this.settingsDialog.showModal();
  }

  closeSettings() {
    if (this.settingsDialog) this.settingsDialog.close();
  }

  openRoom() {
    if (this.roomDialog?.showModal) this.roomDialog.showModal();
  }

  closeRoom() {
    if (this.roomDialog) this.roomDialog.close();
  }
}

export const ui = new UIController();
