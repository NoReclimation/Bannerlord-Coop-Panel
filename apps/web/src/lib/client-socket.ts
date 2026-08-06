import { io, type Socket } from 'socket.io-client';

/**
 * Shared browser Socket.IO connection.
 *
 * - Polling-first avoids "WebSocket is closed before the connection is
 *   established" when a reverse proxy/Vite upgrade path is flaky; Socket.IO
 *   then upgrades to websocket when available.
 * - Ref-counted + deferred teardown survives React Strict Mode's
 *   mount → unmount → remount without aborting an in-flight handshake.
 */
let shared: Socket | null = null;
let refs = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

export function acquireClientSocket(token: string): Socket {
  refs += 1;
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }

  if (!shared) {
    shared = io('/client', {
      path: '/client-socket',
      transports: ['polling', 'websocket'],
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
  } else {
    shared.auth = { token };
    if (!shared.connected) {
      shared.connect();
    }
  }

  return shared;
}

export function releaseClientSocket(): void {
  refs = Math.max(0, refs - 1);
  if (refs > 0 || !shared) return;

  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (refs === 0 && shared) {
      shared.disconnect();
      shared = null;
    }
  }, 0);
}
