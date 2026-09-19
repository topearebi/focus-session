/**
 * Rally - Hardened Serverless Multi-Peer Sync Engine
 * P2P DataChannel mesh with host relay, ping keep-alive, and auto-reconnection.
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
   * Ensures the PeerJS CDN script is fully parsed and available
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
   * Initializes local Peer instance with redundant STUN/TURN configurations
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
        this.attemptReconnect();
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
          reject(new Error('Room host is offline or room does not exist.'));
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Listens for incoming WebRTC DataChannel connections
   */
  setupIncomingListener() {
    this.peer.on('connection', (conn) => {
      this.attachConnectionHandlers(conn);
    });
  }

  /**
   * Configures handlers on each individual DataChannel
   */
  attachConnectionHandlers(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      store.setConnectionStatus('connected');

      // 1. Send immediate local state snapshot
      this.sendStateTo(conn);

      // 2. If we are the room host, relay the full peer roster to coordinate full mesh
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

  /**
   * Host-only: Introduces all connected peers to each other
   */
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

  /**
   * Creates a new Squad Room as the Host
   */
  async createRoom() {
    store.setConnectionStatus('connecting');
    const roomId = await this.initPeer();
    store.setRoomId(roomId, true);
    this.updateLocationHash(roomId);
    this.ensureDataHeartbeat();
    return roomId;
  }

  /**
   * Joins an existing Squad Room as a Guest
   */
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

  /**
   * Leaves the active room and releases resources
   */
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

  /**
   * Prevents WebSocket idle timeout by pinging broker every 15s
   */
  startSignalingKeepAlive() {
    clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.peer && !this.peer.disconnected && this.peer.socket && this.peer.socket._open) {
        this.peer.socket.send({ type: 'PING' });
      }
    }, 15000);
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= 5) {
      console.warn('[PeerSync] Max reconnection attempts reached.');
      return;
    }
    this.reconnectAttempts++;
    setTimeout(() => {
      if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
        this.peer.reconnect();
      }
    }, 2000 * this.reconnectAttempts);
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

    // Handle peer mesh introduction from Host
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

    // Update peer card
    store.updatePeer(senderId, {
      displayName: data.profile?.displayName || 'Teammate',
      avatarColor: data.profile?.avatarColor || '#38bdf8',
      quest: data.quest,
      timer: data.timer,
    });

    const localState = store.getState();

    // Master clock synchronization
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
}

export const peerSync = new PeerSyncEngine();
