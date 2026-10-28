import { AppError } from '../errors/AppError.js';

export type RfidAccountLevel = 'ADMINISTRADOR' | 'EDITOR';

export function isRfidSocketRequestAllowed(path: string, authMode: string | null, originTrusted: boolean): boolean {
  return path === '/ws/rfid' && authMode === 'cookie' && originTrusted;
}

export function assertRfidAllowedForAccount(level: RfidAccountLevel): void {
  if (level === 'ADMINISTRADOR') {
    throw new AppError(403, 'backend.usuarios.rfid_admin_password_only');
  }
}
