import { randomBytes } from 'node:crypto';

const CODE_TTL_MS = 30_000;
const MAX_PENDING_CODES = 1000;
const pendingCodes = new Map<string, { token: string; expiresAt: number }>();

export function createRfidLoginCode(token: string): string {
  const now = Date.now();
  for (const [code, entry] of pendingCodes) {
    if (entry.expiresAt <= now) pendingCodes.delete(code);
  }
  while (pendingCodes.size >= MAX_PENDING_CODES) {
    const oldest = pendingCodes.keys().next().value as string | undefined;
    if (!oldest) break;
    pendingCodes.delete(oldest);
  }

  const code = randomBytes(32).toString('base64url');
  pendingCodes.set(code, { token, expiresAt: now + CODE_TTL_MS });
  return code;
}

export function consumeRfidLoginCode(code: string): string | null {
  const entry = pendingCodes.get(code);
  if (!entry) return null;
  pendingCodes.delete(code);
  return entry.expiresAt > Date.now() ? entry.token : null;
}
