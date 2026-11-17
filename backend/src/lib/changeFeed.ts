import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * In-memory change feed behind GET /sync/estado.
 *
 * Why: clients poll /sync/estado every 30 s. The previous implementation ran 2-3 AuditLog queries per poll, which
 * kept the Neon compute awake all day (Neon only scales to zero after ~5 idle minutes). The feed is now answered
 * from memory with zero database queries.
 *
 * How it works:
 * - `writeAuditLog` (called inside every mutation transaction) reports its entity to the request-scoped collector
 *   (`coletarMudancasDaRequisicao`, an AsyncLocalStorage store).
 * - When the response finishes, i.e. after the service has committed, the collected entities get new sequence
 *   numbers. Sequence numbers are therefore assigned in commit order, so the cursor can never skip a transaction
 *   that commits late (the old 10 s lag on AuditLog ids is no longer needed).
 * - A request that rolls back after reporting an entity still registers it: over-reporting only costs clients
 *   one extra reload, under-reporting would hide a change.
 *
 * Cursor: an opaque decimal string. Sequence numbers start FOLGA_INICIAL_S after the boot time in seconds since
 * 2026-01-01 and advance by max(previous + 1, current second), so they keep growing across restarts. Known residual
 * gap: a client still holding a cursor that the previous process issued ahead of the clock (bursts of more than one
 * change per second, or a restart within FOLGA_INICIAL_S of the previous boot) can miss that process's last changes;
 * the app's periodic full reload covers it. Values stay below the int32 limit enforced by
 * sync.schema.ts until about 2094. Cursors from before this boot, from the old AuditLog-id scheme, or from the
 * future (another process) get every synchronized entity, so the client reloads everything once.
 *
 * Assumes a single API process (see adminActivity.ts). With replicas, each process would need a shared feed.
 */

/** Entities clients may be told about. 'Usuario' is deliberately absent (it would leak logout/password timing). */
export const ENTIDADES_SINCRONIZADAS = ['Categoria', 'Emprestimo', 'Equipamento', 'Ocorrencia', 'Responsavel'] as const;

/** How many changes are kept; a client further behind than this gets every entity. */
export const LIMITE_FEED = 1000;

/** Seconds are counted from here so cursors stay well inside the int32 range accepted by sync.schema.ts. */
const EPOCA_FEED_MS = Date.UTC(2026, 0, 1);

/**
 * Longer than the longest interactive transaction (prisma.ts: timeout 15 s + maxWait 5 s). Used when no commit
 * signal is available: audit writes outside a request, after its response, or after the client disconnected.
 */
export const ATRASO_REGISTRO_SEM_SINAL_MS = 25_000;

/**
 * Gap between the previous process's cursors and this one's. The app subtracts MARGEM_CURSOR_INICIAL (50) from its
 * first cursor; with the gap that value still lands inside this process's range, so a new session after a quiet
 * boot is not mistaken for a pre-boot cursor (which would force a full reload of every store).
 */
const FOLGA_INICIAL_S = 120;

export interface EstadoFeed {
  cursor: string;
  entidades: string[];
}

const sincronizadas = new Set<string>(ENTIDADES_SINCRONIZADAS);
const segundosAgora = () => Math.floor((Date.now() - EPOCA_FEED_MS) / 1000);

export function criarFeedMudancas(limite = LIMITE_FEED) {
  const inicio = segundosAgora();
  let seq = inicio + FOLGA_INICIAL_S;
  /**
   * Cursors below this may have missed changes: before the boot second they come from the previous process (or
   * the old AuditLog-id scheme); later, it is the highest sequence number dropped from `log`.
   */
  let descartadoAte = inicio;
  const log: Array<{ seq: number; entidade: string }> = [];

  function registrar(entidades: Iterable<string>): void {
    for (const entidade of new Set(entidades)) {
      if (!sincronizadas.has(entidade)) continue;
      seq = Math.max(seq + 1, segundosAgora());
      log.push({ seq, entidade });
    }
    if (log.length > limite) {
      const removidos = log.splice(0, log.length - limite);
      descartadoAte = removidos[removidos.length - 1].seq;
    }
  }

  function estado(desde?: number): EstadoFeed {
    const cursor = String(seq);
    if (desde === undefined || desde === seq) return { cursor, entidades: [] };
    // Unknown position (before this boot or the oldest kept change, or ahead of this process): report everything.
    if (desde < descartadoAte || desde > seq) return { cursor, entidades: [...ENTIDADES_SINCRONIZADAS] };
    const entidades = new Set<string>();
    for (let i = log.length - 1; i >= 0 && log[i].seq > desde; i -= 1) entidades.add(log[i].entidade);
    return { cursor, entidades: [...entidades].sort() };
  }

  return { registrar, estado };
}

const feed = criarFeedMudancas();
export const obterEstadoFeed = feed.estado;
export const registrarMudancas = feed.registrar;

type Coleta = { entidades: Set<string>; publicada: boolean };
const coletor = new AsyncLocalStorage<Coleta>();

function publicar(coleta: Coleta): void {
  if (coleta.publicada) return;
  coleta.publicada = true;
  if (coleta.entidades.size > 0) registrarMudancas(coleta.entidades);
}

/**
 * Collects the entities changed while handling a request and registers them once the response is finished
 * (services commit before the controller responds).
 *
 * If the client disconnects first ('close' without 'finish'), the handler and its transaction may still be running,
 * so publication waits ATRASO_REGISTRO_SEM_SINAL_MS instead of happening before the commit.
 */
export function coletarMudancasDaRequisicao(_req: Request, res: Response, next: NextFunction): void {
  const coleta: Coleta = { entidades: new Set(), publicada: false };
  res.once('finish', () => publicar(coleta));
  res.once('close', () => {
    if (!res.writableFinished) setTimeout(() => publicar(coleta), ATRASO_REGISTRO_SEM_SINAL_MS).unref();
  });
  coletor.run(coleta, next);
}

/** Called by writeAuditLog inside the mutation transaction. */
export function anotarMudanca(entidade: string): void {
  const coleta = coletor.getStore();
  if (coleta && !coleta.publicada) {
    coleta.entidades.add(entidade);
    return;
  }
  // No commit signal (outside a request, or after its response was already published): register now and once more
  // after the longest possible transaction, so clients that reloaded before the commit are told again.
  registrarMudancas([entidade]);
  setTimeout(() => registrarMudancas([entidade]), ATRASO_REGISTRO_SEM_SINAL_MS).unref();
}
