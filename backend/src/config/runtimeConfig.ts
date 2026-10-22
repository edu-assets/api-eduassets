import { isIP } from 'node:net';

export function parsePort(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${name} deve ser uma porta inteira entre 1 e 65535.`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} deve ser uma porta inteira entre 1 e 65535.`);
  }
  return port;
}

export function parseTrustProxy(value: string | undefined): false | number | string[] {
  if (value === undefined || value.trim() === '' || value === 'false') return false;
  if (value === 'true') throw new Error('TRUST_PROXY=true não é permitido; configure o número exato de proxies ou os endereços confiáveis.');
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (!Number.isSafeInteger(hops) || hops > 10) throw new Error('TRUST_PROXY numérico deve estar entre 0 e 10.');
    return hops === 0 ? false : hops;
  }
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  const valid = entries.every((entry) => {
    const [address, prefix] = entry.split('/');
    const version = isIP(address);
    if (!version) return false;
    if (prefix === undefined) return true;
    if (!/^\d+$/.test(prefix)) return false;
    const bits = Number(prefix);
    return bits >= 0 && bits <= (version === 4 ? 32 : 128);
  });
  if (!entries.length || !valid) throw new Error('TRUST_PROXY deve ser false, um número de hops entre 0 e 10 ou uma lista de IP/CIDR válida.');
  return entries;
}

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV deve ser development, test ou production.');
  }
  const configuredPort = parsePort(env.PORT, 'PORT');
  const compatibilityPort = parsePort(env.BACKEND_PORT, 'BACKEND_PORT');
  const port = configuredPort ?? compatibilityPort ?? 3000;
  const host = env.HOST?.trim() || (nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1');
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  const corsOrigins = (env.CORS_ORIGIN ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (nodeEnv !== 'test') {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatório para iniciar o backend.');
    for (const [name, value] of [['DATABASE_URL', env.DATABASE_URL], ['DIRECT_URL', env.DIRECT_URL]] as const) {
      if (value === undefined) continue;
      let parsed: URL;
      try { parsed = new URL(value); } catch { throw new Error(`${name} deve ser uma URL PostgreSQL válida.`); }
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2) {
        throw new Error(`${name} deve ser uma URL PostgreSQL válida.`);
      }
    }
  }
  for (const origin of corsOrigins) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error('CORS_ORIGIN deve conter origens HTTP(S) válidas.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('CORS_ORIGIN deve conter origens HTTP(S) sem caminho, query ou fragmento.');
  }
  if (env.RFID_BRIDGE_ENABLED === 'true' && (!env.RFID_BRIDGE_SECRET || env.RFID_BRIDGE_SECRET.length < 32)) {
    throw new Error('RFID_BRIDGE_SECRET deve conter pelo menos 32 caracteres quando RFID_BRIDGE_ENABLED=true.');
  }
  if (nodeEnv === 'production') {
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET é obrigatório em produção e deve conter pelo menos 32 caracteres.');
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatório em produção.');
    if (!corsOrigins.length) throw new Error('CORS_ORIGIN deve listar as origens frontend permitidas em produção.');
    if (env.TRUST_PROXY === undefined) throw new Error('TRUST_PROXY deve ser definido explicitamente conforme a topologia de rede.');
  }
  return { nodeEnv, port, host, trustProxy, corsOrigins };
}
