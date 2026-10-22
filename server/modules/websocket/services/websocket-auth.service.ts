import type { VerifyClientCallbackSync } from 'ws';

import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';

type WebSocketAuthDependencies = {
  authenticateWebSocket: (token: string | null) => {
    id?: string | number;
    userId?: string | number;
    username?: string;
    [key: string]: unknown;
  } | null;
};

/**
 * Resolves the implicit local user for websocket upgrade requests before the
 * `connection` handler runs. Login was removed, so no session token is
 * validated or required.
 */
export function verifyWebSocketClient(
  info: Parameters<VerifyClientCallbackSync<AuthenticatedWebSocketRequest>>[0],
  dependencies: WebSocketAuthDependencies
): boolean {
  const request = info.req as AuthenticatedWebSocketRequest;
  const upgradeUrl = new URL(request.url ?? '/', 'http://localhost');

  console.log('WebSocket connection attempt to:', upgradeUrl.pathname);

  const user = dependencies.authenticateWebSocket(null);
  if (!user) {
    console.log('[WARN] WebSocket local user resolution failed');
    return false;
  }

  request.user = user;
  console.log('[OK] WebSocket authenticated for local user:', user.username);
  return true;
}
