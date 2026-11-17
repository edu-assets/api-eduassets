import { ENTIDADES_SINCRONIZADAS, obterEstadoFeed, type EstadoFeed } from '../lib/changeFeed.js';

export { ENTIDADES_SINCRONIZADAS };
export type EstadoSync = EstadoFeed;

/**
 * Lightweight change feed for client polling. Answered from memory (lib/changeFeed.ts) without any database query,
 * so polling never keeps the Neon compute awake. Only the cursor and entity names are exposed.
 *
 * Without `desde` no entities are reported (the client only needs the current cursor).
 */
export function obterEstadoSync(desde?: number): EstadoSync {
  return obterEstadoFeed(desde);
}
