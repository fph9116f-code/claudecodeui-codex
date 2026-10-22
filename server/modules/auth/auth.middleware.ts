import type { Request, RequestHandler } from 'express';

import { userDb } from '@/modules/database/index.js';

/** The implicit account every request runs as on a single-user local install. */
type LocalUser = {
  id: number;
  username: string;
};

/** The user shape attached to WebSocket upgrade requests by the websocket module. */
type WebSocketUser = {
  id: number;
  userId: number;
  username: string;
};

type RequestWithUser = Request & { user?: LocalUser };

/**
 * Resolves the installation's implicit local user, creating it on first use.
 * Login was removed because this app only serves the machine it runs on, so
 * every API request shares the same account.
 */
function getLocalUser(): LocalUser {
  const user = userDb.ensureLocalUser();
  return { id: user.id, username: user.username };
}

// Optional API key middleware
export const validateApiKey: RequestHandler = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

/**
 * Attaches the implicit local user to every API request. Routes still read
 * `req.user.id` for per-user preferences, drafts, notifications and API keys.
 */
export const attachLocalUser: RequestHandler = (req, res, next) => {
  try {
    (req as RequestWithUser).user = getLocalUser();
    next();
  } catch (error) {
    console.error('Failed to resolve the local user:', error);
    res.status(500).json({ error: 'Failed to resolve the local user' });
  }
};

/**
 * WebSocket counterpart of `attachLocalUser`. The token argument remains in
 * the upgrade-verification signature but is intentionally ignored: there is no
 * login session to validate.
 */
export function resolveWebSocketUser(_token: string | null): WebSocketUser | null {
  try {
    const user = getLocalUser();
    return { id: user.id, userId: user.id, username: user.username };
  } catch (error) {
    console.error('Failed to resolve the local user for WebSocket:', error);
    return null;
  }
}
