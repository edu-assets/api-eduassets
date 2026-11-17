import { prisma } from './prisma.js';

/**
 * Per-process cache of the user fields that authentication checks on every request.
 *
 * Why: the auth middleware used to query `Usuario` on every authenticated request, including the
 * 30 s background sync polling. Every query keeps the Neon compute awake (it only scales to zero
 * after ~5 idle minutes), so the TTL is deliberately longer than that window.
 *
 * Safety:
 * - Every code path that changes `ativo`, `nivelAcesso` or `sessionVersion` (logout, password
 *   change/reset/recovery, user update) calls `invalidarUsuarioSessao` after its transaction, so
 *   revocations through the API are immediate.
 * - Mutating requests (POST/PUT/PATCH/DELETE) always read the database (`fresco`), so a write can
 *   never be authorized from a stale entry.
 * - Changes made outside the API (manual SQL, seed scripts) are picked up within the TTL.
 * - A read that started before an invalidation never repopulates the cache (generation check),
 *   so a concurrent request cannot store a pre-revocation value.
 *
 * Like `adminActivity.ts`, this assumes a single API process. With several replicas, invalidation
 * would need shared state (or a short TTL) before this cache can be relied on.
 */

export type UsuarioSessao = {
  id: number;
  nivelAcesso: 'ADMINISTRADOR' | 'EDITOR';
  sessionVersion: number;
  ativo: boolean;
};

type Carregar = (id: number) => Promise<UsuarioSessao | null>;

export const TTL_CACHE_USUARIO_MS = 15 * 60 * 1000;
const MAX_ENTRADAS = 5_000;

export function criarCacheUsuarioSessao(carregar: Carregar, ttlMs = TTL_CACHE_USUARIO_MS) {
  const entradas = new Map<number, { usuario: UsuarioSessao | null; expiraEm: number }>();
  /** One counter per user id ever invalidated: bounded by the number of accounts, so it is never pruned. */
  const geracoes = new Map<number, number>();
  let epoca = 0; // bumped by limpar(): invalidates in-flight reads for every id

  const geracao = (id: number) => `${epoca}:${geracoes.get(id) ?? 0}`;

  function podar(agora: number): void {
    for (const [id, entrada] of entradas) {
      if (entrada.expiraEm <= agora) entradas.delete(id);
    }
    // Map iteration is insertion order, so the oldest entries go first.
    for (const id of entradas.keys()) {
      if (entradas.size <= MAX_ENTRADAS) break;
      entradas.delete(id);
    }
  }

  async function obter(id: number, opcoes: { fresco?: boolean } = {}): Promise<UsuarioSessao | null> {
    const agora = Date.now();
    if (!opcoes.fresco) {
      const entrada = entradas.get(id);
      if (entrada && entrada.expiraEm > agora) return entrada.usuario;
    }
    const geracaoInicial = geracao(id);
    const usuario = await carregar(id);
    if (geracao(id) === geracaoInicial) {
      // Prune only when full: expired entries are harmless (checked on read) and the auth path stays O(1).
      if (entradas.size >= MAX_ENTRADAS) podar(Date.now());
      entradas.delete(id); // re-insert so the entry moves to the end of the eviction order
      // Unknown users are cached too, so a deleted account's token cannot force a query per request.
      entradas.set(id, { usuario, expiraEm: Date.now() + ttlMs });
    }
    return usuario;
  }

  function invalidar(id: number): void {
    entradas.delete(id);
    geracoes.set(id, (geracoes.get(id) ?? 0) + 1);
  }

  function limpar(): void {
    entradas.clear();
    geracoes.clear();
    epoca += 1;
  }

  return { obter, invalidar, limpar, tamanho: () => entradas.size };
}

const cache = criarCacheUsuarioSessao((id) =>
  prisma.usuario.findUnique({
    where: { id },
    select: { id: true, nivelAcesso: true, sessionVersion: true, ativo: true },
  })
);

/** Returns the user's current auth fields, from the cache unless `fresco` is set. */
export const obterUsuarioSessao = cache.obter;
/** Call after any committed change to a user's `ativo`, `nivelAcesso` or `sessionVersion`. */
export const invalidarUsuarioSessao = cache.invalidar;
/** Drops every cached entry (tests and diagnostics). */
export const limparCacheUsuariosSessao = cache.limpar;
