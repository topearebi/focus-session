/**
 * Rally - UI Controller & DOM Orchestrator
 * Renders rounds HUD, cycle indicators, three-phase timer dials, and squad state.
 */

import { dynamicFavicon } from './favicon.js';
import { store } from './state.js';

class UIController {
  constructor() {
    this.html = document.documentElement;

    // Header & Room elements
    this.roomBtn = document.getElementById('room-btn');
    this.roomStatusIndicator = document.getElementById('room-status-indicator');

    // Timer & Round HUD elements
    this.roundHudBadge = document.getElementById('round-hud-badge');
    this.cycleDotsContainer = document.getElementById('cycle-dots-container');
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
    this.sprintMinInput = document.getElementById('sprint-min');
    this.sprintSecInput = document.getElementById('sprint-sec');
    this.shortRestMinInput = document.getElementById('short-rest-min');
    this.shortRestSecInput = document.getElementById('short-rest-sec');
    this.longRestMinInput = document.getElementById('long-rest-min');
    this.longRestSecInput = document.getElementById('long-rest-sec');
    this.roundsBeforeLongInput = document.getElementById('rounds-before-long');
    this.totalRoundsInput = document.getElementById('total-rounds');
    this.autoStartBreaksToggle = document.getElementById('auto-start-breaks');
    this.autoStartSprintsToggle = document.getElementById('auto-start-sprints');
    this.timerDirectionSelect = document.getElementById('timer-direction-select');
    this.soundToggle = document.getElementById('sound-toggle');

    // Room Modal elements
    this.roomDialog = document.getElementById('room-dialog');
    this.roomModalStatus = document.getElementById('room-modal-status');
    this.syncModeToggle = document.getElementById('sync-mode-toggle');
    this.shareLinkInput = document.getElementById('share-link-input');

    // SVG radial progress setup (r = 150 -> 2 * PI * 150 ≈ 942.48)
    this.circumference = 2 * Math.PI * 150;
    this.lastAnnouncedMinute = null;
  }

  formatTime(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  getModeLabel(mode) {
    switch (mode) {
      case 'shortRest':
        return 'Short Rest';
      case 'longRest':
        return 'Long Rest';
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

  render(state) {
    const { session, config, quest, room, profile } = state;
    const { mode, status, remainingMs, totalDurationMs, currentRound } = session;

    // 1. Theme and mode badge
    this.html.setAttribute('data-theme-mode', mode);
    this.sessionModeBadge.textContent = this.getModeLabel(mode);

    // 2. Round HUD and Cycle Dots
    const totalRoundsText = config.totalRounds > 0 ? ` of ${config.totalRounds}` : '';
    this.roundHudBadge.textContent = `Round ${currentRound}${totalRoundsText}`;
    this.renderCycleDots(currentRound, config.roundsBeforeLongRest);

    // 3. Digits & Toggle Button
    const timeFormatted = this.formatTime(remainingMs);
    this.timerDisplay.textContent = timeFormatted;

    const isRunning = status === 'running';
    this.primaryToggleBtn.textContent = isRunning ? 'Pause' : 'Start';
    this.primaryToggleBtn.setAttribute(
      'aria-label',
      isRunning ? `Pause ${this.getModeLabel(mode)}` : `Start ${this.getModeLabel(mode)}`
    );

    // 4. Progress Dial Offset
    const elapsedRatio = totalDurationMs > 0 ? (totalDurationMs - remainingMs) / totalDurationMs : 0;
    const normalizedRatio = config.timerDirection === 'countup' 
      ? 1 
      : Math.min(1, Math.max(0, elapsedRatio));
    const offset = this.circumference * (1 - normalizedRatio);
    this.progressIndicator.style.strokeDashoffset = `${offset}px`;

    // 5. Browser Title & Favicon
    document.title = `${timeFormatted} • Rally`;
    dynamicFavicon.update(normalizedRatio, mode);

    // 6. Current Quest & Stepping Stones
    if (document.activeElement !== this.questTitleInput) {
      this.questTitleInput.value = quest.title;
    }
    this.renderSteppingStones(quest.stones);

    // 7. Room Network Indicator & Peers
    this.renderRoomStatus(room);
    this.renderPeerGrid(room.peers);

    // 8. Hydrate Settings Modal Inputs without overriding active typing
    const activeEl = document.activeElement;
    const isEditingSettings = this.settingsDialog && this.settingsDialog.open && this.settingsDialog.contains(activeEl);

    if (!isEditingSettings) {
      if (this.displayNameInput) this.displayNameInput.value = profile.displayName;

      const sSec = config.sprintDurationSeconds || 1500;
      if (this.sprintMinInput) this.sprintMinInput.value = Math.floor(sSec / 60);
      if (this.sprintSecInput) this.sprintSecInput.value = sSec % 60;

      const srSec = config.shortRestDurationSeconds || 300;
      if (this.shortRestMinInput) this.shortRestMinInput.value = Math.floor(srSec / 60);
      if (this.shortRestSecInput) this.shortRestSecInput.value = srSec % 60;

      const lrSec = config.longRestDurationSeconds || 900;
      if (this.longRestMinInput) this.longRestMinInput.value = Math.floor(lrSec / 60);
      if (this.longRestSecInput) this.longRestSecInput.value = lrSec % 60;

      if (this.roundsBeforeLongInput) this.roundsBeforeLongInput.value = config.roundsBeforeLongRest;
      if (this.totalRoundsInput) this.totalRoundsInput.value = config.totalRounds;
      if (this.autoStartBreaksToggle) this.autoStartBreaksToggle.checked = config.autoStartBreaks;
      if (this.autoStartSprintsToggle) this.autoStartSprintsToggle.checked = config.autoStartSprints;
      if (this.timerDirectionSelect) this.timerDirectionSelect.value = config.timerDirection;
      if (this.soundToggle) this.soundToggle.checked = config.soundEnabled;
    }

    if (this.syncModeToggle) this.syncModeToggle.checked = room.syncTimers;

    // 9. Accessibility Milestones
    this.evaluateA11yMilestones(remainingMs, status);
  }

  renderCycleDots(currentRound, cycleLength) {
    if (!this.cycleDotsContainer) return;
    this.cycleDotsContainer.innerHTML = '';
    
    // Cycle wraps based on roundsBeforeLongRest
    const safeCycle = Math.max(1, cycleLength || 4);
    const activeDotIndex = ((currentRound - 1) % safeCycle) + 1;

    for (let i = 1; i <= safeCycle; i++) {
      const dot = document.createElement('span');
      dot.className = 'cycle-dot';
      if (i === activeDotIndex) {
        dot.setAttribute('data-active', 'true');
      }
      this.cycleDotsContainer.appendChild(dot);
    }
  }

  renderSteppingStones(stones) {
    if (!this.steppingStonesList || !this.stonesCounter) return;

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

  renderRoomStatus(room) {
    const { roomId, connectionStatus, peers } = room;
    const peerCount = Object.keys(peers).length + 1;

    if (this.roomBtn) {
      this.roomBtn.setAttribute('data-status', connectionStatus);
    }

    if (!roomId) {
      if (this.roomStatusIndicator) this.roomStatusIndicator.textContent = '👥 Solo';
      if (this.roomModalStatus) this.roomModalStatus.textContent = 'Solo (No active room)';
      if (this.shareLinkInput) this.shareLinkInput.value = '';
      return;
    }

    if (connectionStatus === 'connecting') {
      if (this.roomStatusIndicator) this.roomStatusIndicator.textContent = '🟡 Connecting...';
      if (this.roomModalStatus) this.roomModalStatus.textContent = 'Connecting to squad mesh...';
    } else if (connectionStatus === 'connected') {
      if (this.roomStatusIndicator) this.roomStatusIndicator.textContent = `🟢 ${peerCount} in Squad`;
      if (this.roomModalStatus) this.roomModalStatus.textContent = `Connected (${peerCount} active)`;
      if (this.shareLinkInput) {
        this.shareLinkInput.value = `${window.location.origin}${window.location.pathname}#room=${roomId}`;
      }
    } else {
      if (this.roomStatusIndicator) this.roomStatusIndicator.textContent = '🔴 Offline';
      if (this.roomModalStatus) this.roomModalStatus.textContent = 'Disconnected. Check your network connection.';
    }
  }

  renderPeerGrid(peers) {
    if (!this.peerSection || !this.peerGrid) return;
    const peerEntries = Object.entries(peers);

    if (peerEntries.length === 0) {
      this.peerSection.style.display = 'none';
      this.peerGrid.innerHTML = '';
      return;
    }

    this.peerSection.style.display = 'flex';
    this.peerGrid.innerHTML = '';

    peerEntries.forEach(([_, data]) => {
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

  evaluateA11yMilestones(remainingMs, status) {
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
