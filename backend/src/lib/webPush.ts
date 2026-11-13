import { createECDH } from 'node:crypto';
import webpush from 'web-push';
import { logger } from './logger.js';

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Destination of one Web Push message. Never log any of these fields. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one already-serialized payload. Rejections should carry the push service status as `statusCode`. */
export type PushSender = (target: PushTarget, payload: string) => Promise<void>;

const VAPID_VARIABLES = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SEND_TTL_SECONDS = 3600;
const SEND_TIMEOUT_MS = 5000;

function decodedLength(value: string): number | null {
  if (!BASE64URL.test(value)) return null;
  return Buffer.from(value, 'base64url').length;
}

/**
 * The public key must be the uncompressed P-256 point derived from the private key. A key that is merely 65 bytes
 * long (typo, truncated copy, keys from different pairs) makes browsers fail `pushManager.subscribe()` with
 * "Registration failed - push service error", or the push services reject every send with 401/403.
 */
function isMatchingKeyPair(publicKey: string, privateKey: string): boolean {
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    return ecdh.getPublicKey().equals(Buffer.from(publicKey, 'base64url'));
  } catch {
    return false;
  }
}

function isValidSubject(subject: string): boolean {
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)) return true;
  try {
    return new URL(subject).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * VAPID settings for Web Push. Returns null when the feature is not (or not validly) configured;
 * an invalid or partial configuration disables push instead of stopping the API (the feature is optional).
 * Keys come from `npx web-push generate-vapid-keys`: a 65-byte public key and a 32-byte private key, base64url,
 * and the public key must be the one derived from the private key.
 */
export function getPushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const [publicKey, privateKey, subject] = VAPID_VARIABLES.map((name) => env[name]?.trim() ?? '');
  if (!publicKey && !privateKey && !subject) return null;
  if (!publicKey || !privateKey || !subject) {
    logger.warn('Notificações push desativadas: configuração VAPID incompleta.');
    return null;
  }
  if (decodedLength(publicKey) !== 65 || decodedLength(privateKey) !== 32 || !isValidSubject(subject)) {
    logger.warn('Notificações push desativadas: configuração VAPID inválida.');
    return null;
  }
  if (!isMatchingKeyPair(publicKey, privateKey)) {
    logger.warn('Notificações push desativadas: VAPID_PUBLIC_KEY não corresponde a VAPID_PRIVATE_KEY.');
    return null;
  }
  return { publicKey, privateKey, subject };
}

// undefined = read the environment; null/object = test override.
let configOverride: PushConfig | null | undefined;
let senderOverride: PushSender | null = null;
let cachedEnvConfig: { key: string; value: PushConfig | null } | null = null;

/** Test hook: forces the configuration (null = not configured, undefined = back to the environment). */
export function setPushConfigForTests(config: PushConfig | null | undefined): void {
  configOverride = config;
}

/** Test hook: replaces the real delivery to the push service (pass null to restore). */
export function setPushSenderForTests(sender: PushSender | null): void {
  senderOverride = sender;
}

function currentConfig(): PushConfig | null {
  if (configOverride !== undefined) return configOverride;
  // Cache per distinct environment values so a bad configuration is reported once, not on every request.
  const key = VAPID_VARIABLES.map((name) => process.env[name] ?? '').join('\u0000');
  if (!cachedEnvConfig || cachedEnvConfig.key !== key) cachedEnvConfig = { key, value: getPushConfig() };
  return cachedEnvConfig.value;
}

export function isPushConfigured(): boolean {
  return currentConfig() !== null;
}

export function getVapidPublicKey(): string | null {
  return currentConfig()?.publicKey ?? null;
}

let vapidApplied: string | null = null;

async function sendWithWebPush(target: PushTarget, payload: string): Promise<void> {
  const config = currentConfig();
  if (!config) throw new Error('Push não configurado.');
  const fingerprint = `${config.publicKey}\u0000${config.subject}`;
  if (vapidApplied !== fingerprint) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    vapidApplied = fingerprint;
  }
  await webpush.sendNotification(
    { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
    payload,
    { TTL: SEND_TTL_SECONDS, urgency: 'high', timeout: SEND_TIMEOUT_MS }
  );
}

/** Delivers one payload to one subscription. Rejects with `statusCode` set when the push service answered with an error. */
export async function enviar(target: PushTarget, payload: string): Promise<void> {
  await (senderOverride ?? sendWithWebPush)(target, payload);
}
