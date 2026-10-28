const SENSITIVE_FIELD = /(?:authorization|cookie|password|senha|token|secret|credential|api[_-]?key|rfid|session|email|login|student|solicitante|responsavel|cpf|telefone|phone)/i;
const SENSITIVE_QUERY_KEY = /(?:authorization|cookie|password|senha|token|secret|credential|api[_-]?key|rfid|session|code|email|login|student|solicitante|responsavel|cpf|telefone|phone)/i;

export function redactLogText(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(/([?&](?:access[_-]?token|refresh[_-]?token|token|code|password|senha|secret|authorization|cookie|session|rfid|email|login|api[_-]?key)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
}

function redactValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_FIELD.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactLogText(value);
  if (value instanceof Error) return { name: value.name, message: redactLogText(value.message) };
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)])
    );
  }
  return value;
}

/** Mutates a Winston record so every message and nested metadata value is scrubbed before formatting. */
export function redactLogRecord<T extends Record<string, unknown>>(record: T): T {
  const target = record as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    target[key] = redactValue(target[key], key);
  }
  return record;
}

/** Preserve the route and harmless filters while removing secret or personal query values. */
export function sanitizeUrlForLog(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, 'http://log.invalid');
    for (const key of new Set(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return '[invalid-url]';
  }
}
