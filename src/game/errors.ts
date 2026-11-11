/**
 * The last thing that went wrong, for the ?perf=1 readout (line E), so a
 * screenshot from a phone says what broke. The game keeps running past it.
 */
export const lastError = { count: 0, msg: '', where: '' };

export function noteError(e: unknown, where = ''): void {
  lastError.count++;
  const err = e instanceof Error ? e : new Error(String(e));
  // The first line of the stack names the file and line; keep it short enough to read off a screenshot.
  const at = (err.stack ?? '').split('\n').find((l) => /\.(ts|js)/.test(l) && !l.includes(err.message)) ?? '';
  lastError.msg = err.message.slice(0, 120);
  lastError.where = `${where} ${at.trim().replace(/^at\s+/, '').replace(/https?:\/\/[^/]+\//, '').slice(0, 90)}`.trim();
  console.error(where || 'error', e);
}
