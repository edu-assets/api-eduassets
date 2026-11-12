import { z } from 'zod';

const MAX_ENDPOINT_LENGTH = 1024;

/** Hosts of the browser push services. The server POSTs to the endpoint, so anything else would be an SSRF vector. */
const EXACT_PUSH_HOSTS = new Set(['fcm.googleapis.com']);
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.push.services.mozilla.com', '.notify.windows.com'];
const SUBDOMAIN_LABELS = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+$/;

export function isAllowedPushHost(hostname: string): boolean {
  if (EXACT_PUSH_HOSTS.has(hostname)) return true;
  return PUSH_HOST_SUFFIXES.some((suffix) => {
    if (!hostname.endsWith(suffix)) return false;
    // Everything before the suffix (including its trailing dot) must be plain DNS labels.
    return SUBDOMAIN_LABELS.test(hostname.slice(0, hostname.length - suffix.length + 1));
  });
}

/**
 * https only, no credentials, no explicit port, no fragment and a host on the allowlist.
 * The authority is checked on the raw string because URL normalizes away a default port (":443").
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length === 0 || endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  if (/[\s\\\u0000-\u001f\u007f]/.test(endpoint)) return false;
  const match = /^https:\/\/([^/?#]*)(?:[/?]|$)/.exec(endpoint);
  if (!match) return false;
  const authority = match[1];
  if (authority.includes('@') || authority.includes(':') || authority.includes('[')) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
  return isAllowedPushHost(url.hostname);
}

const base64Url = (min: number, max: number) =>
  z.string().min(min, 'backend.notificacoes.chave_invalida').max(max, 'backend.notificacoes.chave_invalida')
    .regex(/^[A-Za-z0-9_-]+$/, 'backend.notificacoes.chave_invalida');

export const pushEndpointSchema = z.string('backend.notificacoes.endpoint_invalido')
  .max(MAX_ENDPOINT_LENGTH, 'backend.notificacoes.endpoint_invalido')
  .refine(isAllowedPushEndpoint, 'backend.notificacoes.endpoint_invalido');

export const pushPreferenciasSchema = z.object({
  emprestimo: z.boolean('backend.notificacoes.preferencias_invalidas'),
  devolucao: z.boolean('backend.notificacoes.preferencias_invalidas'),
  ocorrencia: z.boolean('backend.notificacoes.preferencias_invalidas'),
});

export const pushInscricaoSchema = z.object({
  inscricao: z.object({
    endpoint: pushEndpointSchema,
    keys: z.object({
      p256dh: base64Url(80, 100),
      auth: base64Url(16, 32),
    }),
  }),
  preferencias: pushPreferenciasSchema,
});

/** Removal only touches the caller's own rows, so any plausible string is accepted (no allowlist). */
export const pushRemocaoSchema = z.object({
  endpoint: z.string('backend.notificacoes.endpoint_invalido').min(1, 'backend.notificacoes.endpoint_invalido')
    .max(MAX_ENDPOINT_LENGTH, 'backend.notificacoes.endpoint_invalido'),
});

export type PushPreferencias = z.infer<typeof pushPreferenciasSchema>;
export type PushInscricaoInput = z.infer<typeof pushInscricaoSchema>;
