import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { sendMail } from '../lib/mailer.js';
import { montarEmailRecuperacao, type Idioma } from '../lib/passwordRecoveryEmail.js';
import { getRuntimeConfig } from '../config/runtimeConfig.js';
import { normalizarLogin } from '../schemas/usuario.schema.js';

export const RESET_TOKEN_TTL_MINUTES = 30;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINK_INVALIDO = 'backend.auth.link_recuperacao_invalido';

export type { Idioma };

export function gerarResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Public app origin used in the emailed link: APP_PUBLIC_URL, or the first CORS origin. */
export function getAppPublicUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.APP_PUBLIC_URL?.trim();
  const url = configured || getRuntimeConfig(env).corsOrigins[0];
  if (!url) throw new Error('Defina APP_PUBLIC_URL (ou CORS_ORIGIN) para gerar links de recuperação de senha.');
  return url.replace(/\/+$/, '');
}

export function montarLinkRecuperacao(token: string, appUrl: string = getAppPublicUrl()): string {
  // The token travels in the URL fragment, so it is never sent to servers, proxies or Referer headers.
  return `${appUrl}/#redefinir-senha=${token}`;
}

/** Optional public contact details shown in the email (SUPPORT_EMAIL is also used as Reply-To). */
export function getEmailContacts(env: NodeJS.ProcessEnv = process.env): { supportEmail?: string; siteUrl?: string } {
  const supportEmail = env.SUPPORT_EMAIL?.trim() || undefined;
  const siteUrl = env.PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || undefined;
  return { ...(supportEmail ? { supportEmail } : {}), ...(siteUrl ? { siteUrl } : {}) };
}

/**
 * Starts a self-service recovery. Never reveals whether the account exists: unknown, inactive or
 * non-email logins silently do nothing, and the HTTP layer answers identically before this runs.
 */
export async function solicitarRecuperacao(login: string, idioma: Idioma = 'pt'): Promise<boolean> {
  const normalizado = normalizarLogin(login);
  if (!EMAIL_PATTERN.test(normalizado)) return false;
  const usuario = await prisma.usuario.findFirst({
    where: { login: { equals: normalizado, mode: 'insensitive' }, ativo: true },
    select: { id: true, nome: true, login: true },
  });
  if (!usuario) return false;

  const token = gerarResetToken();
  const agora = Date.now();
  await prisma.$transaction(async (tx) => {
    // Only the newest link is valid; also drop long-expired tokens of any user.
    await tx.passwordResetToken.deleteMany({
      where: { OR: [{ usuarioId: usuario.id }, { expiresAt: { lt: new Date(agora - 24 * 60 * 60 * 1000) } }] },
    });
    await tx.passwordResetToken.create({
      data: { usuarioId: usuario.id, tokenHash: hashResetToken(token), expiresAt: new Date(agora + RESET_TOKEN_TTL_MINUTES * 60 * 1000) },
    });
    await writeAuditLog(tx, usuario.id, 'PASSWORD_RESET_REQUEST', 'Usuario', usuario.id, []);
  });

  const appUrl = getAppPublicUrl();
  const conteudo = montarEmailRecuperacao({
    nome: usuario.nome,
    login: usuario.login,
    link: montarLinkRecuperacao(token, appUrl),
    idioma,
    solicitadoEm: new Date(agora),
    validadeMinutos: RESET_TOKEN_TTL_MINUTES,
    appUrl,
    ...getEmailContacts(),
  });
  await sendMail({ to: usuario.login, ...conteudo });
  return true;
}

/** Consumes a recovery token (single use) and sets the new password; all sessions are revoked. */
export async function redefinirSenhaComToken(token: string, senha: string): Promise<void> {
  const tokenHash = hashResetToken(token);
  // Hash first so valid and invalid tokens take comparable time.
  const novoHash = await bcrypt.hash(senha, 12);
  const agora = new Date();
  await prisma.$transaction(async (tx) => {
    const registro = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, usuarioId: true, usedAt: true, expiresAt: true, usuario: { select: { ativo: true } } },
    });
    if (!registro || registro.usedAt || registro.expiresAt <= agora || !registro.usuario.ativo) {
      throw new AppError(400, LINK_INVALIDO);
    }
    const consumido = await tx.passwordResetToken.updateMany({ where: { id: registro.id, usedAt: null }, data: { usedAt: agora } });
    if (consumido.count !== 1) throw new AppError(400, LINK_INVALIDO);

    await tx.usuario.update({
      where: { id: registro.usuarioId },
      data: { passwordHash: novoHash, sessionVersion: { increment: 1 } },
    });
    await tx.passwordResetToken.deleteMany({ where: { usuarioId: registro.usuarioId, id: { not: registro.id } } });
    await writeAuditLog(tx, registro.usuarioId, 'PASSWORD_RESET_SELF', 'Usuario', registro.usuarioId, ['passwordHash', 'sessionVersion']);
  });
}
