import type { Request, Response } from 'express';
import { verifyToken } from './jwt.js';

function getCookieSettings(req: Request): { name: string; secure: boolean } {
  const secure = process.env.NODE_ENV === 'production' || req.secure;
  return { name: secure ? '__Host-eduassets_session' : 'eduassets_session', secure };
}

export function getSessionCookieToken(req: Request): string | null {
  const { name } = getCookieSettings(req);
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const prefix = `${name}=`;
  const pair = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!pair) return null;
  const value = pair.slice(prefix.length);
  try { return decodeURIComponent(value) || null; } catch { return null; }
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const { name, secure } = getCookieSettings(req);
  const claims = verifyToken(token);
  if (!claims.exp) throw new Error('Token de sessão sem prazo de expiração.');
  const maxAgeSeconds = Math.floor(claims.exp - Date.now() / 1000);
  if (maxAgeSeconds <= 0) throw new Error('Token de sessão expirado.');

  const attributes = [
    `${name}=${encodeURIComponent(token)}`,
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${new Date(claims.exp * 1000).toUTCString()}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) attributes.push('Secure');
  res.append('Set-Cookie', attributes.join('; '));
  res.setHeader('Cache-Control', 'no-store');
}

export function clearSessionCookie(req: Request, res: Response): void {
  const { name, secure } = getCookieSettings(req);
  const attributes = [
    `${name}=`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) attributes.push('Secure');
  res.append('Set-Cookie', attributes.join('; '));
  res.setHeader('Cache-Control', 'no-store');
}
