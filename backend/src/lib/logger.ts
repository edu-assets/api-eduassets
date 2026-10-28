import winston from 'winston';
import { redactLogRecord } from './logRedaction.js';

const isProduction = process.env.NODE_ENV === 'production';
const redact = winston.format((info) => {
  redactLogRecord(info as unknown as Record<string, unknown>);
  return info;
})();

const devFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  redact,
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}: ${stack ?? message}${metaStr}`;
  })
);

const prodFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  redact,
  winston.format.timestamp(),
  winston.format.json()
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
  format: isProduction ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
});
