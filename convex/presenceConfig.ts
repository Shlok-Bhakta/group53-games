// Shared by the server and the client.
// Clients heartbeat every HEARTBEAT_MS while the app is visible. A player counts as online if their
// last heartbeat is newer than ONLINE_WINDOW_MS. Clients re-check that on a timer, since queries
// don't re-run as time passes.
export const HEARTBEAT_MS = 10_000;
export const ONLINE_WINDOW_MS = 30_000;
