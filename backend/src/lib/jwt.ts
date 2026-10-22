import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

const JWT_SECRET_RAW = process.env.JWT_SECRET;
if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 32) {
  throw new Error(
    'JWT_SECRET ausente ou fraco. Defina uma variável de ambiente JWT_SECRET com pelo menos 32 caracteres aleatórios antes de iniciar o servidor.'
  );
}
const JWT_SECRET: string = JWT_SECRET_RAW;
const JWT_EXPIRES_IN = '8h';

export interface AppJwtPayload {
  sub: number;
  nivelAcesso: 'ADMINISTRADOR' | 'EDITOR';
  jti: string;
  iat?: number;
  exp?: number;
}

export function signToken(payload: Pick<AppJwtPayload, 'sub' | 'nivelAcesso'>): string {
  return jwt.sign({ ...payload, jti: randomUUID() }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function verifyToken(token: string): AppJwtPayload {
  const decoded = jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
  });

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    typeof (decoded as any).sub !== 'number' ||
    typeof (decoded as any).jti !== 'string' ||
    ((decoded as any).nivelAcesso !== 'ADMINISTRADOR' && (decoded as any).nivelAcesso !== 'EDITOR')
  ) {
    throw new Error('Token payload inválido.');
  }

  return decoded as unknown as AppJwtPayload;
}