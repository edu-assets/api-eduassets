/**
 * Per-process activity cache. Missing cache state fails closed for tokens older
 * than the idle window; a restart therefore cannot revive an old admin JWT.
 * Deployments with multiple replicas still require shared state and are not
 * supported for administrator sessions until that infrastructure is configured.
 */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_ACTIVITY_ENTRIES = 10_000;
const ultimaAtividade = new Map<string, number>();

function podarAtividadeAgora(now: number): void {
  for (const [jti, timestamp] of ultimaAtividade) {
    if (now - timestamp >= IDLE_TIMEOUT_MS) ultimaAtividade.delete(jti);
  }
  if (ultimaAtividade.size <= MAX_ACTIVITY_ENTRIES) return;
  const maisAntigos = [...ultimaAtividade.entries()]
    .sort(([, a], [, b]) => a - b)
    .slice(0, ultimaAtividade.size - MAX_ACTIVITY_ENTRIES);
  for (const [jti] of maisAntigos) ultimaAtividade.delete(jti);
}

export function registrarAtividadeAdmin(jti: string): void {
  const now = Date.now();
  podarAtividadeAgora(now);
  ultimaAtividade.set(jti, now);
}

export function sessaoAdminExpirada(jti: string, issuedAt: number | undefined): boolean {
  const ultima = ultimaAtividade.get(jti);
  const referencia = ultima ?? (issuedAt === undefined ? Number.NEGATIVE_INFINITY : issuedAt * 1000);
  return Date.now() - referencia >= IDLE_TIMEOUT_MS;
}
