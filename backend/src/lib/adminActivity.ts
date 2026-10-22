/**
 * Per-process activity cache. Missing cache state fails closed for tokens older
 * than the idle window; a restart therefore cannot revive an old admin JWT.
 * Deployments with multiple replicas still require shared state and are not
 * supported for administrator sessions until that infrastructure is configured.
 */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ultimaAtividade = new Map<string, number>();

export function registrarAtividadeAdmin(jti: string): void {
  ultimaAtividade.set(jti, Date.now());
}

export function sessaoAdminExpirada(jti: string, issuedAt: number | undefined): boolean {
  const ultima = ultimaAtividade.get(jti);
  const referencia = ultima ?? (issuedAt === undefined ? Number.NEGATIVE_INFINITY : issuedAt * 1000);
  return Date.now() - referencia >= IDLE_TIMEOUT_MS;
}
