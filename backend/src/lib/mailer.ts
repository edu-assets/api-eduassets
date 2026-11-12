import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { parsePort } from '../config/runtimeConfig.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export type MailSender = (message: MailMessage) => Promise<void>;

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

const MAIL_VARIABLES = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as const;

/**
 * SMTP settings for outgoing mail (e.g. Zoho Mail: smtppro.zoho.com:465 for domain accounts).
 * Returns null when mail is not configured; throws when it is only partially configured.
 */
export function getMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig | null {
  const values = MAIL_VARIABLES.map((name) => env[name]?.trim() ?? '');
  if (values.every((value) => !value)) return null;
  const missing = MAIL_VARIABLES.filter((_, index) => !values[index]);
  if (missing.length) throw new Error(`Configuração de e-mail incompleta: defina ${missing.join(', ')}.`);
  const [host, user, pass, from] = values;
  const port = parsePort(env.SMTP_PORT?.trim() || undefined, 'SMTP_PORT') ?? 465;
  return { host, port, secure: port === 465, user, pass, from };
}

let transporter: Transporter | undefined;
let senderOverride: MailSender | null = null;

/** Test hook: replaces SMTP delivery (pass null to restore). */
export function setMailSenderForTests(sender: MailSender | null): void {
  senderOverride = sender;
}

export function isMailConfigured(): boolean {
  return senderOverride !== null || getMailConfig() !== null;
}

export async function sendMail(message: MailMessage): Promise<void> {
  if (senderOverride) {
    await senderOverride(message);
    return;
  }
  const config = getMailConfig();
  if (!config) throw new Error('SMTP não configurado.');
  transporter ??= nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await transporter.sendMail({ from: config.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
}
