/**
 * Rally - Hardened Serverless Multi-Peer Sync Engine
 * P2P DataChannel mesh with process cloning support, keep-alive, and manual resync.
 */

import { store } from './state.js';

class PeerSyncEngine {
  constructor() {
    this.peer = null;
    this.connections = new Map(); // peerId -> DataConnection
    this.heartbeatInterval = null;
    this.pingInterval = null;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Ensures the PeerJS CDN script is loaded and ready
   */
  async ensurePeerJSReady(timeoutMs = 8000) {
    const startTime = Date.now();
    while (typeof window.Peer === 'undefined') {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error('Timed out waiting for PeerJS library to load.');
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Initializes local Peer instance with redundant STUN/TURN servers
   */
  async initPeer(preferredId = null) {
    if (this.peer && !this.peer.destroyed && !this.peer.disconnected) {
      return this.peer.id;
    }

    await this.ensurePeerJSReady();

    return new Promise((resolve, reject) => {
      const id = preferredId || `rally-${Math.random().toString(36).slice(2, 9)}`;

      const peerConfig = {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'turn:eu-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjspassword' },
          ],
        },
      };

      this.peer = new window.Peer(id, peerConfig);

      this.peer.on('open', (assignedId) => {
        store.setConnectionStatus('connected');
        this.reconnectAttempts = 0;
        this.setupIncomingListener();
        this.startSignalingKeepAlive();
        resolve(assignedId);
      });

      this.peer.on('disconnected', () => {
        store.setConnectionStatus('connecting');
        this.attemptAutoReconnect();
      });

      this.peer.on('close', () => {
        store.setConnectionStatus('disconnected');
        this.cleanup();
      });

      this.peer.on('error', (err) => {
        console.warn('[PeerSync] Broker error:', err);
        if (err.type === 'unavailable-id' && preferredId) {
          this.initPeer(null).then(resolve).catch(reject);
        } else if (err.type === 'peer-unavailable') {
          store.setConnectionStatus('disconnected');
          reject(new Error('Room does not exist or host is offline.'));
        } else {
          store.setConnectionStatus('disconnected');
          reject(err);
        }
      });
    });
  }

  setupIncomingListener() {
    this.peer.on('connection', (conn) => {
      this.attachConnectionHandlers(conn);
    });
  }

  attachConnectionHandlers(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      store.setConnectionStatus('connected');

      // 1. Send immediate local state snapshot
      this.sendStateTo(conn);

      // 2. Host coordinates mesh directory relay
      const { isHost } = store.getState().room;
      if (isHost) {
        this.relayMeshDirectory();
      }

      this.ensureDataHeartbeat();
    });

    conn.on('data', (data) => {
      this.handleIncomingData(conn.peer, data);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      store.removePeer(conn.peer);
      if (this.connections.size === 0 && !store.getState().room.isHost) {
        store.setConnectionStatus('disconnected');
      }
    });

    conn.on('error', (err) => {
      console.warn(`[PeerSync] Channel error with ${conn.peer}:`, err);
      this.connections.delete(conn.peer);
      store.removePeer(conn.peer);
    });
  }

  relayMeshDirectory() {
    const activePeerIds = Array.from(this.connections.keys());
    const packet = {
      type: 'PEER_DIRECTORY',
      peers: activePeerIds,
    };

    for (const conn of this.connections.values()) {
      if (conn.open) {
        conn.send(packet);
      }
    }
  }

  async createRoom() {
    store.setConnectionStatus('connecting');
    const roomId = await this.initPeer();
    store.setRoomId(roomId, true);
    this.updateLocationHash(roomId);
    this.ensureDataHeartbeat();
    return roomId;
  }

  async joinRoom(targetRoomId) {
    if (this.isConnecting) return;
    this.isConnecting = true;
    store.setConnectionStatus('connecting');

    try {
      await this.initPeer();
      store.setRoomId(targetRoomId, false);

      const conn = this.peer.connect(targetRoomId, {
        reliable: true,
      });

      this.attachConnectionHandlers(conn);
      this.updateLocationHash(targetRoomId);
      this.ensureDataHeartbeat();
    } catch (err) {
      store.setConnectionStatus('disconnected');
      throw err;
    } finally {
      this.isConnecting = false;
    }
  }

  async joinByCode(rawCode) {
    if (!rawCode || !rawCode.trim()) {
      throw new Error('Please enter a valid room code.');
    }

    let code = rawCode.trim().toLowerCase();
    code = code.replace(/.*#room=/, '').replace(/^rally-/, '');
    const targetRoomId = `rally-${code}`;
    return this.joinRoom(targetRoomId);
  }

  async reconnect() {
    const { roomId, isHost } = store.getState().room;
    store.setConnectionStatus('connecting');

    for (const conn of this.connections.values()) {
      try { conn.close(); } catch (_) {}
    }
    this.connections.clear();

    if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
      this.peer.reconnect();
    } else {
      if (this.peer && !this.peer.destroyed) {
        this.peer.destroy();
        this.peer = null;
      }
      if (roomId) {
        if (isHost) {
          await this.createRoom();
        } else {
          await this.joinRoom(roomId);
        }
      } else {
        await this.initPeer();
      }
    }
  }

  attemptAutoReconnect() {
    if (this.reconnectAttempts >= 5) {
      store.setConnectionStatus('disconnected');
      return;
    }
    this.reconnectAttempts++;
    setTimeout(() => {
      if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
        this.peer.reconnect();
      }
    }, 2000 * this.reconnectAttempts);
  }

  leaveRoom() {
    this.cleanup();
    store.setRoomId(null, false);
    store.setConnectionStatus('disconnected');
    this.updateLocationHash('');
  }

  cleanup() {
    clearInterval(this.heartbeatInterval);
    clearInterval(this.pingInterval);
    this.heartbeatInterval = null;
    this.pingInterval = null;

    for (const conn of this.connections.values()) {
      try {
        conn.close();
      } catch (_) {}
    }
    this.connections.clear();

    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
      this.peer = null;
    }
  }

  startSignalingKeepAlive() {
    clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.peer && !this.peer.disconnected && this.peer.socket && this.peer.socket._open) {
        this.peer.socket.send({ type: 'PING' });
      }
    }, 15000);
  }

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
        activeStone: activeStone ? activeStone.text : 'All stones completed!',
        stones: state.quest.stones, // Full stepping stones list for cloning
      },
      timer: {
        mode: state.session.mode,
        status: state.session.status,
        currentRound: state.session.currentRound,
        remainingMs: state.session.remainingMs,
        targetTimestamp: state.session.targetTimestamp,
      },
      roomConfig: {
        syncTimers: state.room.syncTimers,
        isHost: state.room.isHost,
      },
    };
  }

  sendStateTo(conn) {
    if (conn && conn.open) {
      conn.send(this.getLocalPayload());
    }
  }

  broadcast() {
    const payload = this.getLocalPayload();
    for (const conn of this.connections.values()) {
      if (conn.open) {
        conn.send(payload);
      }
    }
  }

  handleIncomingData(senderId, data) {
    if (!data) return;

    if (data.type === 'PEER_DIRECTORY' && Array.isArray(data.peers)) {
      data.peers.forEach((peerId) => {
        if (peerId !== this.peer?.id && !this.connections.has(peerId)) {
          const directConn = this.peer.connect(peerId, { reliable: true });
          this.attachConnectionHandlers(directConn);
        }
      });
      return;
    }

    if (data.type !== 'SYNC_STATE') return;

    store.updatePeer(senderId, {
      displayName: data.profile?.displayName || 'Teammate',
      avatarColor: data.profile?.avatarColor || '#38bdf8',
      quest: {
        ...data.quest,
        stones: Array.isArray(data.quest?.stones) ? data.quest.stones : [],
      },
      timer: data.timer,
    });

    const localState = store.getState();

    // Host-led timer synchronization
    if (localState.room.syncTimers && !localState.room.isHost && data.roomConfig?.isHost) {
      if (
        localState.session.mode !== data.timer.mode ||
        localState.session.currentRound !== data.timer.currentRound
      ) {
        store.setMode(data.timer.mode, data.timer.currentRound);
      }

      store.updateRemaining(data.timer.remainingMs);

      if (data.timer.status === 'running' && localState.session.status !== 'running') {
        store.startTimer();
      } else if (data.timer.status !== 'running' && localState.session.status === 'running') {
        store.pauseTimer();
      }
    }
  }

  ensureDataHeartbeat() {
    if (!this.heartbeatInterval) {
      this.heartbeatInterval = setInterval(() => {
        if (this.connections.size > 0) {
          this.broadcast();
        }
      }, 1500);
    }
  }

  updateLocationHash(roomId) {
    if (roomId) {
      window.location.hash = `room=${roomId}`;
    } else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  getCleanRoomCode() {
    const { roomId } = store.getState().room;
    if (!roomId) return '';
    return roomId.replace(/^rally-/, '');
  }
}

export const peerSync = new PeerSyncEngine();
