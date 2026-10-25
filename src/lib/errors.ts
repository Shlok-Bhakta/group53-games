// Convex wraps server errors as "[CONVEX M(fn)] [Request ID: ...] Server Error ... Uncaught Error: <message>".
export function errorText(err: unknown) {
  const raw = (err as Error)?.message ?? String(err);
  const uncaught = raw.match(/Uncaught Error: ([^\n]*)/);
  if (uncaught) return uncaught[1].trim();
  if (/Server Error/.test(raw)) return "The server hiccuped. Try again in a second.";
  return raw.split("\n")[0];
}
