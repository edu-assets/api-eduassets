import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';
import { AppError } from '../errors/AppError.js';
import { hashRfidToken, safeCompareSecrets } from '../lib/rfidToken.js';
import { publicarLoginRfid } from '../lib/rfidBridge.js';
import { logger } from '../lib/logger.js';

const RFID_BRIDGE_SECRET = process.env.RFID_BRIDGE_SECRET;
// Random per-process dummy hash prevents account existence from skipping bcrypt work.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'eduAssets-dummy-' + require('node:crypto').randomBytes(32).toString('hex'),
  12
);

function ehLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
}

export async function login(loginStr: string, password: string) {
  const loginNormalizado = loginStr.trim().toLowerCase();
  const usuario = await prisma.usuario.findFirst({
    where: { login: { equals: loginNormalizado, mode: 'insensitive' } },
  });
  if (!usuario) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    throw new AppError(401, 'backend.auth.credenciais_invalidas');
  }

  const hashValido = typeof usuario.passwordHash === 'string' && usuario.passwordHash.startsWith('$2');
  if (!hashValido) logger.warn('Hash de senha inválida encontrado durante autenticação.');

  let senhaValida = false;
  try {
    senhaValida = await bcrypt.compare(password, hashValido ? usuario.passwordHash : DUMMY_PASSWORD_HASH);
  } catch (error) {
    logger.error('Falha ao validar hash de senha durante autenticação.', { error });
    throw new AppError(401, 'backend.auth.credenciais_invalidas');
  }

  if (!senhaValida) {
    throw new AppError(401, 'backend.auth.credenciais_invalidas');
  }

  const token = signToken({ sub: usuario.id, nivelAcesso: usuario.nivelAcesso, sessionVersion: usuario.sessionVersion });

  return {
    token,
    user: {
      id: usuario.id,
      nome: usuario.nome,
      login: usuario.login,
      nivelAcesso: usuario.nivelAcesso,
    },
  };
}

export async function obterPerfil(usuarioId: number) {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario) {
    throw new AppError(401, 'backend.auth.usuario_nao_existe');
  }

  return {
    id: usuario.id,
    nome: usuario.nome,
    login: usuario.login,
    nivelAcesso: usuario.nivelAcesso,
  };
}

export async function alterarSenha(usuarioId: number, senhaAtual: string, novaSenha: string) {
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario) {
    throw new AppError(401, 'backend.auth.usuario_nao_existe');
  }

  const senhaValida = await bcrypt.compare(senhaAtual, usuario.passwordHash);
  if (!senhaValida) {
    throw new AppError(422, 'backend.auth.senha_atual_incorreta');
  }

  const novoHash = await bcrypt.hash(novaSenha, 12);
  const updated = await prisma.usuario.update({
    where: { id: usuario.id },
    data: { passwordHash: novoHash, sessionVersion: { increment: 1 } },
    select: { id: true, nivelAcesso: true, sessionVersion: true },
  });
  // Reissue only the current session at the new version; other sessions are revoked.
  return signToken({ sub: updated.id, nivelAcesso: updated.nivelAcesso, sessionVersion: updated.sessionVersion });
}

export async function logout(usuarioId: number): Promise<void> {
  await prisma.usuario.update({
    where: { id: usuarioId },
    data: { sessionVersion: { increment: 1 } },
  });
}

export async function loginRfid(
  tokenHex: string,
  remoteAddress: string | undefined,
  bridgeSecretHeader: string | undefined
) {
  if (!ehLoopback(remoteAddress)) {
    throw new AppError(403, 'backend.auth.origem_nao_permitida');
  }

  if (!safeCompareSecrets(bridgeSecretHeader, RFID_BRIDGE_SECRET)) {
    throw new AppError(401, 'backend.auth.nao_autorizado');
  }

  const hash = hashRfidToken(tokenHex);
  const usuario = await prisma.usuario.findUnique({ where: { rfidTokenHash: hash } });
  if (!usuario) {
    throw new AppError(401, 'backend.auth.cartao_nao_reconhecido');
  }

  const jwtToken = signToken({ sub: usuario.id, nivelAcesso: usuario.nivelAcesso, sessionVersion: usuario.sessionVersion });

  publicarLoginRfid({
    token: jwtToken,
    user: {
      id: usuario.id,
      nome: usuario.nome,
      login: usuario.login,
      nivelAcesso: usuario.nivelAcesso,
    },
  });
}
