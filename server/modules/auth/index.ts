// attachLocalUser: used by the server entrypoint to attach the implicit local user to API requests.
export { attachLocalUser } from './auth.middleware.js';
// resolveWebSocketUser: used by WebSocket setup to attach the implicit local user to upgrade requests.
export { resolveWebSocketUser } from './auth.middleware.js';
// validateApiKey: used by the server entrypoint for optional API-wide key validation.
export { validateApiKey } from './auth.middleware.js';
