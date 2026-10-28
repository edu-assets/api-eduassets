import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';
import { gerarRfidToken, hashRfidToken } from '../lib/rfidToken.js';
import { logger } from '../lib/logger.js';
import { assertRfidAllowedForAccount } from '../lib/rfidPolicy.js';
import { normalizarLogin, type UsuarioCreateSchemaInput, type UsuarioUpdateSchemaInput } from '../schemas/usuario.schema.js';
import type { Prisma } from '@prisma/client';

const RFID_BRIDGE_TIMEOUT_MS = 40000;
const RFID_BRIDGE_SECRET = process.env.RFID_BRIDGE_SECRET;
const RFID_BRIDGE_ENABLED = process.env.RFID_BRIDGE_ENABLED === 'true';

if (RFID_BRIDGE_ENABLED && !RFID_BRIDGE_SECRET) {
  throw new Error('RFID_BRIDGE_SECRET não definida no ambiente do backend com RFID_BRIDGE_ENABLED=true.');
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}

async function writeAudit(tx: Prisma.TransactionClient, actorId: number, action: string, entityId: number, changedFields: string[]) {
  await tx.auditLog.create({
    data: { actorId, action, entity: 'Usuario', entityId: String(entityId), changedFields },
  });
}

export async function listarUsuarios() {
  const usuarios = await prisma.usuario.findMany({
    orderBy: { nome: 'asc' },
    select: { id: true, nome: true, login: true, nivelAcesso: true, ativo: true, createdAt: true, rfidTokenHash: true },
  });
  return usuarios.map((u) => ({
    id: u.id, nome: u.nome, login: u.login, nivelAcesso: u.nivelAcesso, ativo: u.ativo,
    createdAt: u.createdAt.toISOString(), possuiCartaoRfid: Boolean(u.rfidTokenHash),
  }));
}

export async function criarUsuario(dados: UsuarioCreateSchemaInput, actorId: number) {
  const login = normalizarLogin(dados.login);
  const existente = await prisma.usuario.findFirst({ where: { login: { equals: login, mode: 'insensitive' } }, select: { id: true } });
  if (existente) throw new AppError(409, 'backend.geral.registro_duplicado');
  const passwordHash = await bcrypt.hash(dados.senha, 12);
  try {
    return await prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.create({
        data: { nome: dados.nome, login, passwordHash, nivelAcesso: dados.nivelAcesso, createdById: actorId, updatedById: actorId },
        select: { id: true, nome: true, login: true, nivelAcesso: true, ativo: true, createdAt: true },
      });
      await writeAudit(tx, actorId, 'CREATE', usuario.id, ['nome', 'login', 'nivelAcesso', 'ativo']);
      return { ...usuario, createdAt: usuario.createdAt.toISOString(), possuiCartaoRfid: false };
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw new AppError(409, 'backend.geral.registro_duplicado');
    throw error;
  }
}

export async function atualizarUsuario(id: number, dados: UsuarioUpdateSchemaInput, actorId: number) {
  const data: Record<string, unknown> = { ...dados, updatedById: actorId };
  if (dados.login !== undefined) data.login = normalizarLogin(dados.login);
  try {
    return await prisma.$transaction(async (tx) => {
      const changedFields = Object.keys(dados);
      const before = await tx.usuario.findUnique({ where: { id }, select: { nivelAcesso: true, ativo: true } });
      if (!before) throw new AppError(404, 'backend.usuarios.nao_encontrado');
      if ((dados.nivelAcesso !== undefined && dados.nivelAcesso !== before.nivelAcesso) || (dados.ativo === false && before.ativo)) {
        data.sessionVersion = { increment: 1 };
        changedFields.push('sessionVersion');
      }
      const updated = await tx.usuario.update({
        where: { id }, data,
        select: { id: true, nome: true, login: true, nivelAcesso: true, ativo: true, updatedAt: true, rfidTokenHash: true },
      });
      await writeAudit(tx, actorId, 'UPDATE', id, changedFields);
      return { id: updated.id, nome: updated.nome, login: updated.login, nivelAcesso: updated.nivelAcesso, ativo: updated.ativo,
        updatedAt: updated.updatedAt.toISOString(), possuiCartaoRfid: Boolean(updated.rfidTokenHash) };
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw new AppError(409, 'backend.geral.registro_duplicado');
    throw error;
  }
}

export async function resetarSenhaUsuario(id: number, senha: string, actorId: number): Promise<void> {
  const passwordHash = await bcrypt.hash(senha, 12);
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id }, data: { passwordHash, sessionVersion: { increment: 1 }, updatedById: actorId } });
    await writeAudit(tx, actorId, 'PASSWORD_RESET', id, ['senha', 'sessionVersion']);
  });
}

export async function provisionarCartaoRfid(id: number, actorId: number) {
  if (!RFID_BRIDGE_ENABLED) throw new AppError(503, 'backend.usuarios.rfid_indisponivel');
  const usuario = await prisma.usuario.findUnique({ where: { id }, select: { id: true, nome: true, nivelAcesso: true } });
  if (!usuario) throw new AppError(404, 'backend.usuarios.nao_encontrado');
  assertRfidAllowedForAccount(usuario.nivelAcesso);
  const tokenHex = gerarRfidToken();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RFID_BRIDGE_TIMEOUT_MS);
  try {
    const bridgeResponse = await fetch('http://127.0.0.1:3001/provision', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RFID-Bridge-Secret': RFID_BRIDGE_SECRET ?? '' },
      body: JSON.stringify({ token: tokenHex }), signal: controller.signal,
    });
    if (!bridgeResponse.ok) throw new Error(`Bridge HTTP status: ${bridgeResponse.status}`);
    await prisma.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id }, data: { rfidTokenHash: hashRfidToken(tokenHex), updatedById: actorId } });
      await writeAudit(tx, actorId, 'RFID_PROVISION', id, ['rfidTokenHash']);
    });
    return { message: 'Modo de gravação ativo com sucesso.', usuario: { id: usuario.id, nome: usuario.nome } };
  } catch (hardwareError) {
    logger.error('Falha ao contatar eduassets-rfid:', { error: hardwareError });
    const timedOut = hardwareError instanceof Error && hardwareError.name === 'AbortError';
    if (hardwareError instanceof AppError) throw hardwareError;
    throw new AppError(502, timedOut ? 'backend.usuarios.rfid_timeout' : 'backend.usuarios.rfid_hardware_indisponivel');
  } finally { clearTimeout(timeoutId); }
}

export async function revogarCartaoRfid(id: number, actorId: number) {
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id }, data: { rfidTokenHash: null, updatedById: actorId } });
    await writeAudit(tx, actorId, 'RFID_REVOKE', id, ['rfidTokenHash']);
  });
}
