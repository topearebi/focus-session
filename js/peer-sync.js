/**
 * Rally - Serverless Multi-Peer Sync Engine
 * Coordinates real-time room mesh via WebRTC DataChannels (PeerJS).
 */

import { store } from './state.js';

class PeerSyncEngine {
  constructor() {
    this.peer = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.heartbeatInterval = null;
    this.isInitialized = false;
  }

  /**
   * Initializes the local peer instance
   */
  async initPeer(preferredId = null) {
    if (this.peer && !this.peer.destroyed) return this.peer;

    return new Promise((resolve, reject) => {
      // Generate a clean room ID prefix if none provided
      const id = preferredId || `rally-${Math.random().toString(36).slice(2, 9)}`;
      
      // Fallback cleanly if PeerJS library is loading via CDN
      if (typeof window.Peer === 'undefined') {
        return reject(new Error('PeerJS not loaded.'));
      }

      this.peer = new window.Peer(id, {
        debug: 1,
      });

      this.peer.on('open', (assignedId) => {
        this.isInitialized = true;
        this.setupIncomingListener();
        resolve(assignedId);
      });

      this.peer.on('error', (err) => {
        console.warn('[PeerSync] Connection error:', err);
        // If preferred ID is taken, fallback to random
        if (err.type === 'unavailable-id' && preferredId) {
          this.initPeer(null).then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Handles incoming peer connections
   */
  setupIncomingListener() {
    this.peer.on('connection', (conn) => {
      this.attachConnectionHandlers(conn);
    });
  }

  /**
   * Configures event listeners for each connected peer DataChannel
   */
  attachConnectionHandlers(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      // Immediately send our local state payload to the newcomer
      this.sendStateTo(conn);
      this.ensureHeartbeat();
    });

    conn.on('data', (data) => {
      this.handleIncomingData(conn.peer, data);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      store.removePeer(conn.peer);
    });

    conn.on('error', (err) => {
      console.warn(`[PeerSync] Connection error with peer ${conn.peer}:`, err);
      this.connections.delete(conn.peer);
      store.removePeer(conn.peer);
    });
  }

  /**
   * Create a new room as Host
   */
  async createRoom() {
    const roomId = await this.initPeer();
    store.setRoomId(roomId, true);
    this.updateLocationHash(roomId);
    this.ensureHeartbeat();
    return roomId;
  }

  /**
   * Join an existing room as a Guest
   */
  async joinRoom(targetRoomId) {
    await this.initPeer();
    store.setRoomId(targetRoomId, false);

    const conn = this.peer.connect(targetRoomId, {
      reliable: true,
    });

    this.attachConnectionHandlers(conn);
    this.updateLocationHash(targetRoomId);
    this.ensureHeartbeat();
  }

  /**
   * Leaves the active room and terminates all peer connections
   */
  leaveRoom() {
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;

    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    this.isInitialized = false;
    store.setRoomId(null, false);
    this.updateLocationHash('');
  }

  /**
   * Assembles current client state payload for broadcasting
   */
  getLocalPayload() {
    const state = store.getState();
    const activeStone = state.quest.stones.find((s) => !s.completed);

    return {
      type: 'SYNC_STATE',
      senderId: this.peer?.id,
      profile: state.profile,
      quest: {
        title: state.quest.title || 'Untitled Quest',
        totalStones: state.quest.stones.length,
        completedStones: state.quest.stones.filter((s) => s.completed).length,
        activeStone: activeStone ? activeStone.text : 'All stones complete!',
      },
      timer: {
        mode: state.session.mode,
        status: state.session.status,
        remainingMs: state.session.remainingMs,
        targetTimestamp: state.session.targetTimestamp,
      },
      roomConfig: {
        syncTimers: state.room.syncTimers,
        isHost: state.room.isHost,
      },
    };
  }

  /**
   * Sends local state to a single connection
   */
  sendStateTo(conn) {
    if (conn && conn.open) {
      conn.send(this.getLocalPayload());
    }
  }

  /**
   * Broadcasts local state to all connected peers
   */
  broadcast() {
    const payload = this.getLocalPayload();
    for (const conn of this.connections.values()) {
      if (conn.open) {
        conn.send(payload);
      }
    }
  }

  /**
   * Processes incoming data from remote peers
   */
  handleIncomingData(senderId, data) {
    if (!data || data.type !== 'SYNC_STATE') return;

    // 1. Update peer directory
    store.updatePeer(senderId, {
      displayName: data.profile?.displayName || 'Teammate',
      avatarColor: data.profile?.avatarColor || '#38bdf8',
      quest: data.quest,
      timer: data.timer,
    });

    const localState = store.getState();

    // 2. Synchronize Master Timer if enabled and incoming payload is from Host
    if (localState.room.syncTimers && !localState.room.isHost && data.roomConfig?.isHost) {
      if (localState.session.mode !== data.timer.mode) {
        store.setMode(data.timer.mode);
      }

      store.updateRemaining(data.timer.remainingMs);

      if (data.timer.status === 'running' && localState.session.status !== 'running') {
        store.startTimer();
      } else if (data.timer.status !== 'running' && localState.session.status === 'running') {
        store.pauseTimer();
      }
    }
  }

  /**
   * Heartbeat interval (transmits state every 2 seconds)
   */
  ensureHeartbeat() {
    if (!this.heartbeatInterval) {
      this.heartbeatInterval = setInterval(() => {
        if (this.connections.size > 0) {
          this.broadcast();
        }
      }, 2000);
    }
  }

  updateLocationHash(roomId) {
    if (roomId) {
      window.location.hash = `room=${roomId}`;
    } else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }
}

export const peerSync = new PeerSyncEngine();
