import morgan from 'morgan';
import { logger } from '../lib/logger.js';
import { sanitizeUrlForLog } from '../lib/logRedaction.js';

const stream = {
  write: (message: string) => logger.info(message.trim()),
};

morgan.token('safe-url', (req) => {
  const originalUrl = (req as typeof req & { originalUrl?: string }).originalUrl;
  return sanitizeUrlForLog(originalUrl ?? req.url ?? '/');
});

export const requestLogger = morgan(
  ':remote-addr :method :safe-url :status :res[content-length] - :response-time ms',
  { stream }
);
