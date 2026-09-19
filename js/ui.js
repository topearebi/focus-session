/**
 * Rally - UI Controller & DOM Orchestrator
 * Manages active step spotlight, collapsible task drawers, acoustic settings, and squad process cloning.
 */

import { dynamicFavicon } from './favicon.js';
import { store } from './state.js';
import { peerSync } from './peer-sync.js';

class UIController {
  constructor() {
    this.html = document.documentElement;

    // Header & Identity elements
    this.inlineNameInput = document.getElementById('inline-name-input');
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

    // Live Sync Banner elements
    this.syncBanner = document.getElementById('sync-banner');
    this.toggleSyncBtn = document.getElementById('toggle-sync-btn');
    this.syncStatusIcon = document.getElementById('sync-status-icon');
    this.syncStatusLabel = document.getElementById('sync-status-label');

    // Quest, Spotlight & Drawer elements
    this.questTitleInput = document.getElementById('quest-title-input');
    this.stonesCounter = document.getElementById('stones-counter');
    this.activeStoneContainer = document.getElementById('active-stone-container');
    this.upcomingStonesDrawer = document.getElementById('upcoming-stones-drawer');
    this.upcomingCountBadge = document.getElementById('upcoming-count-badge');
    this.steppingStonesList = document.getElementById('stepping-stones-list');
    this.completedStonesDrawer = document.getElementById('completed-stones-drawer');
    this.completedCountBadge = document.getElementById('completed-count-badge');
    this.completedStonesList = document.getElementById('completed-stones-list');

    // Peer Grid elements
    this.peerSection = document.getElementById('peer-section');
    this.peerGrid = document.getElementById('peer-grid');

    // Settings Modal elements
    this.settingsDialog = document.getElementById('settings-dialog');
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
    this.soundProfileSelect = document.getElementById('sound-profile-select');

    // Room Modal elements
    this.roomDialog = document.getElementById('room-dialog');
    this.roomModalStatus = document.getElementById('room-modal-status');
    this.retryConnectionBtn = document.getElementById('retry-connection-btn');
    this.roomShareSection = document.getElementById('room-share-section');
    this.displayRoomCode = document.getElementById('display-room-code');
    this.shareLinkInput = document.getElementById('share-link-input');
    this.leaveRoomBtn = document.getElementById('leave-room-btn');

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

    // 1. Theme and mode pill
    this.html.setAttribute('data-theme-mode', mode);
    this.sessionModeBadge.textContent = this.getModeLabel(mode);

    // 2. Inline nickname field (preserve input focus)
    if (this.inlineNameInput && document.activeElement !== this.inlineNameInput) {
      this.inlineNameInput.value = profile.displayName;
    }

    // 3. Round HUD and Cycle Dots
    const totalRoundsText = config.totalRounds > 0 ? ` of ${config.totalRounds}` : '';
    this.roundHudBadge.textContent = `Round ${currentRound}${totalRoundsText}`;
    this.renderCycleDots(currentRound, config.roundsBeforeLongRest);

    // 4. Digits & Primary Toggle Button
    const timeFormatted = this.formatTime(remainingMs);
    this.timerDisplay.textContent = timeFormatted;

    const isRunning = status === 'running';
    this.primaryToggleBtn.textContent = isRunning ? 'Pause' : 'Start';
    this.primaryToggleBtn.setAttribute(
      'aria-label',
      isRunning ? `Pause ${this.getModeLabel(mode)}` : `Start ${this.getModeLabel(mode)}`
    );

    // 5. Progress Dial Offset
    const elapsedRatio = totalDurationMs > 0 ? (totalDurationMs - remainingMs) / totalDurationMs : 0;
    const normalizedRatio = config.timerDirection === 'countup' 
      ? 1 
      : Math.min(1, Math.max(0, elapsedRatio));
    const offset = this.circumference * (1 - normalizedRatio);
    this.progressIndicator.style.strokeDashoffset = `${offset}px`;

    // 6. Browser Title & Favicon
    document.title = `${timeFormatted} • Rally`;
    dynamicFavicon.update(normalizedRatio, mode);

    // 7. Contextual Live Sync Banner
    this.renderSyncBanner(room);

    // 8. Current Quest & Stepping Stones (Spotlight + Drawers)
    if (document.activeElement !== this.questTitleInput) {
      this.questTitleInput.value = quest.title;
    }
    this.renderSteppingStones(quest.stones);

    // 9. Room Network Status & Peer Grid
    this.renderRoomStatus(room);
    this.renderPeerGrid(room.peers);

    // 10. Hydrate Settings Modal Inputs without overriding active edits
    const activeEl = document.activeElement;
    const isEditingSettings = this.settingsDialog && this.settingsDialog.open && this.settingsDialog.contains(activeEl);

    if (!isEditingSettings) {
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
      if (this.soundProfileSelect) this.soundProfileSelect.value = config.soundProfile || 'warm';
    }

    // 11. Screen-reader announcements
    this.evaluateA11yMilestones(remainingMs, status);
  }

  renderSyncBanner(room) {
    if (!this.syncBanner || !this.toggleSyncBtn) return;

    if (!room.roomId) {
      this.syncBanner.style.display = 'none';
      return;
    }

    this.syncBanner.style.display = 'flex';
    this.toggleSyncBtn.setAttribute('data-active', room.syncTimers ? 'true' : 'false');
    this.toggleSyncBtn.setAttribute('aria-pressed', room.syncTimers ? 'true' : 'false');

    if (room.syncTimers) {
      this.syncStatusIcon.textContent = '🔗';
      this.syncStatusLabel.textContent = room.isHost 
        ? 'Timers Linked (You Lead)' 
        : 'Timers Linked (Host Controls)';
    } else {
      this.syncStatusIcon.textContent = '🔓';
      this.syncStatusLabel.textContent = 'Timers Independent (Co-working)';
    }
  }

  renderCycleDots(currentRound, cycleLength) {
    if (!this.cycleDotsContainer) return;
    this.cycleDotsContainer.innerHTML = '';
    
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

  /**
   * Renders the Active Focus spotlight and partitions steps into Upcoming and Completed drawers
   */
  renderSteppingStones(stones) {
    if (!this.stonesCounter) return;

    const completedStones = stones.filter((s) => s.completed);
    const pendingStones = stones.filter((s) => !s.completed);
    this.stonesCounter.textContent = `${completedStones.length} / ${stones.length}`;

    // 1. Active Step Spotlight (First pending stone)
    if (this.activeStoneContainer) {
      this.activeStoneContainer.innerHTML = '';
      if (pendingStones.length > 0) {
        const activeStone = pendingStones[0];
        const card = document.createElement('div');
        card.className = 'active-stone-card';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'stone-checkbox';
        checkbox.checked = false;
        checkbox.setAttribute('aria-label', `Complete active focus: "${activeStone.text}"`);
        checkbox.addEventListener('change', () => store.toggleSteppingStone(activeStone.id));

        const body = document.createElement('div');
        body.className = 'active-stone-body';

        const label = document.createElement('span');
        label.className = 'active-stone-label';
        label.textContent = 'Current Focus';

        const text = document.createElement('span');
        text.className = 'active-stone-text';
        text.textContent = activeStone.text;

        body.appendChild(label);
        body.appendChild(text);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'stone-delete-btn';
        deleteBtn.setAttribute('aria-label', `Delete "${activeStone.text}"`);
        deleteBtn.innerHTML = '&times;';
        deleteBtn.addEventListener('click', () => store.deleteSteppingStone(activeStone.id));

        card.appendChild(checkbox);
        card.appendChild(body);
        card.appendChild(deleteBtn);
        this.activeStoneContainer.appendChild(card);
      }
    }

    // 2. Upcoming Steps Drawer (Subsequent pending stones)
    const upcomingStones = pendingStones.slice(1);
    if (this.upcomingCountBadge) this.upcomingCountBadge.textContent = upcomingStones.length;
    if (this.steppingStonesList) {
      this.steppingStonesList.innerHTML = '';
      upcomingStones.forEach((stone) => {
        this.steppingStonesList.appendChild(this.createStoneListItem(stone));
      });
    }

    // 3. Completed Steps Drawer
    if (this.completedCountBadge) this.completedCountBadge.textContent = completedStones.length;
    if (this.completedStonesList) {
      this.completedStonesList.innerHTML = '';
      completedStones.forEach((stone) => {
        this.completedStonesList.appendChild(this.createStoneListItem(stone));
      });
    }
  }

  createStoneListItem(stone) {
    const li = document.createElement('li');
    li.className = 'stone-item';
    li.setAttribute('data-completed', stone.completed ? 'true' : 'false');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'stone-checkbox';
    checkbox.checked = stone.completed;
    checkbox.setAttribute('aria-label', `Mark "${stone.text}" as ${stone.completed ? 'incomplete' : 'complete'}`);
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
    return li;
  }

  renderRoomStatus(room) {
    const { roomId, connectionStatus, peers } = room;
    const peerCount = Object.keys(peers).length + 1;
    const cleanCode = peerSync.getCleanRoomCode();

    if (this.roomBtn) {
      this.roomBtn.setAttribute('data-status', connectionStatus);
    }

    if (!roomId) {
      if (this.roomStatusIndicator) this.roomStatusIndicator.textContent = '👥 Solo';
      if (this.roomModalStatus) this.roomModalStatus.textContent = 'Solo (No active room)';
      if (this.retryConnectionBtn) this.retryConnectionBtn.style.display = 'none';
      if (this.roomShareSection) this.roomShareSection.style.display = 'none';
      if (this.leaveRoomBtn) this.leaveRoomBtn.style.display = 'none';
      if (this.shareLinkInput) this.shareLinkInput.value = '';
      return;
    }

    if (this.roomShareSection) this.roomShareSection.style.display = 'block';
    if (this.leaveRoomBtn) this.leaveRoomBtn.style.display = 'inline-flex';
    if (this.displayRoomCode) this.displayRoomCode.textContent = cleanCode || '—';

    if (this.shareLinkInput) {
      this.shareLinkInput.value = `${window.location.origin}${window.location.pathname}#room=${roomId}`;
    }

    if (connectionStatus === 'connecting') {
      if (this.roomStatusIndicator) this.roomStatusIndicator.textContent = '🟡 Connecting...';
      if (this.roomModalStatus) this.roomModalStatus.textContent = 'Connecting to squad mesh...';
      if (this.retryConnectionBtn) this.retryConnectionBtn.style.display = 'none';
    } else if (connectionStatus === 'connected') {
      if (this.roomStatusIndicator) this.roomStatusIndicator.textContent = `🟢 ${peerCount} in Squad`;
      if (this.roomModalStatus) this.roomModalStatus.textContent = `Connected (${peerCount} active)`;
      if (this.retryConnectionBtn) this.retryConnectionBtn.style.display = 'none';
    } else {
      if (this.roomStatusIndicator) this.roomStatusIndicator.textContent = '🔴 Offline';
      if (this.roomModalStatus) this.roomModalStatus.textContent = 'Disconnected';
      if (this.retryConnectionBtn) this.retryConnectionBtn.style.display = 'inline-flex';
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

    peerEntries.forEach(([peerId, data]) => {
      const card = document.createElement('article');
      card.className = 'peer-card';
      card.style.setProperty('--peer-accent', data.avatarColor || '#38bdf8');

      const totalStones = data.quest?.totalStones || 0;
      const completedStones = data.quest?.completedStones || 0;
      const progressPercent = totalStones > 0 ? Math.round((completedStones / totalStones) * 100) : 0;
      const hasStonesToCopy = Array.isArray(data.quest?.stones) && data.quest.stones.length > 0;

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

        <div class="peer-footer-row">
          <span class="peer-stats-badge">${completedStones}/${totalStones} (${progressPercent}%)</span>
          ${hasStonesToCopy ? `<button type="button" class="peer-copy-btn" data-peer-id="${peerId}" title="Copy this checklist">Copy Steps</button>` : ''}
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
