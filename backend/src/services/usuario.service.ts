import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../errors/AppError.js';
import { gerarRfidToken, hashRfidToken } from '../lib/rfidToken.js';
import { logger } from '../lib/logger.js';

const RFID_BRIDGE_TIMEOUT_MS = 40000;
const RFID_BRIDGE_SECRET = process.env.RFID_BRIDGE_SECRET;
const RFID_BRIDGE_ENABLED = process.env.RFID_BRIDGE_ENABLED === 'true';

if (RFID_BRIDGE_ENABLED && !RFID_BRIDGE_SECRET) {
  throw new Error('RFID_BRIDGE_SECRET não definida no ambiente do backend com RFID_BRIDGE_ENABLED=true.');
}

export interface UsuarioCreateInput {
  nome: string;
  login: string;
  senha: string;
  nivelAcesso: 'ADMINISTRADOR' | 'EDITOR';
}

export async function listarUsuarios() {
  const usuarios = await prisma.usuario.findMany({
    orderBy: { nome: 'asc' },
    select: {
      id: true,
      nome: true,
      login: true,
      nivelAcesso: true,
      createdAt: true,
      rfidTokenHash: true,
    },
  });

  return (
    usuarios as Array<{
      id: number;
      nome: string;
      login: string;
      nivelAcesso: 'ADMINISTRADOR' | 'EDITOR';
      createdAt: Date;
      rfidTokenHash: string | null;
    }>
  ).map((u) => ({
    id: u.id,
    nome: u.nome,
    login: u.login,
    nivelAcesso: u.nivelAcesso,
    createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt),
    possuiCartaoRfid: Boolean(u.rfidTokenHash),
  }));
}

export async function criarUsuario(dados: UsuarioCreateInput) {
  const login = dados.login.trim().toLowerCase();
  const existente = await prisma.usuario.findFirst({
    where: { login: { equals: login, mode: 'insensitive' } },
  });

  if (existente) {
    throw new AppError(409, 'backend.geral.registro_duplicado');
  }

  const passwordHash = await bcrypt.hash(dados.senha, 12);

  const usuario = await prisma.usuario.create({
    data: {
      nome: dados.nome,
      login,
      passwordHash,
      nivelAcesso: dados.nivelAcesso,
    },
  });

  return {
    id: usuario.id,
    nome: usuario.nome,
    login: usuario.login,
    nivelAcesso: usuario.nivelAcesso,
    createdAt: usuario.createdAt.toISOString(),
    possuiCartaoRfid: false,
  };
}

export async function provisionarCartaoRfid(id: number) {
  if (!RFID_BRIDGE_ENABLED) {
    throw new AppError(503, 'backend.usuarios.rfid_indisponivel');
  }

  // Validação preliminar obrigatória: o usuário deve existir antes de qualquer contato com o hardware
  const usuario = await prisma.usuario.findUnique({
    where: { id },
    select: { id: true, nome: true },
  });

  if (!usuario) {
    throw new AppError(404, 'backend.usuarios.nao_encontrado');
  }

  // Gera o token apenas após validação prévia concluída
  const tokenHex = gerarRfidToken();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RFID_BRIDGE_TIMEOUT_MS);

  try {
    const bridgeResponse = await fetch('http://127.0.0.1:3001/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RFID-Bridge-Secret': RFID_BRIDGE_SECRET ?? '',
      },
      body: JSON.stringify({ token: tokenHex }),
      signal: controller.signal,
    });

    if (!bridgeResponse.ok) {
      throw new Error(`Bridge HTTP status: ${bridgeResponse.status}`);
    }

    await prisma.usuario.update({
      where: { id },
      data: { rfidTokenHash: hashRfidToken(tokenHex) },
    });

    return {
      message: 'Modo de gravação ativo com sucesso.',
      token: tokenHex,
      usuario: { id: usuario.id, nome: usuario.nome },
    };
  } catch (hardwareError) {
    logger.error('Falha ao contatar eduassets-rfid:', { error: hardwareError });
    const expirouPorTimeout = hardwareError instanceof Error && hardwareError.name === 'AbortError';
    throw new AppError(
      502,
      expirouPorTimeout ? 'backend.usuarios.rfid_timeout' : 'backend.usuarios.rfid_hardware_indisponivel'
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function revogarCartaoRfid(id: number) {
  await prisma.usuario.update({
    where: { id },
    data: { rfidTokenHash: null },
  });
}
