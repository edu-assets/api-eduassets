import { z } from 'zod';

const senhaAte72Bytes = (senha: string): boolean => Buffer.byteLength(senha, 'utf8') <= 72;

export const loginSchema = z.object({
  login: z.string().trim().toLowerCase().min(1, 'Login é obrigatório.').max(200),
  password: z.string().min(1, 'Senha é obrigatória.').max(200).refine(senhaAte72Bytes, 'A senha deve ter no máximo 72 bytes em UTF-8.'),
});

export const alterarSenhaSchema = z.object({
  senhaAtual: z.string().min(1, 'Informe a senha atual.').max(200).refine(senhaAte72Bytes, 'A senha deve ter no máximo 72 bytes em UTF-8.'),
  novaSenha: z.string().min(12, 'A nova senha deve ter no mínimo 12 caracteres.').max(200).refine(senhaAte72Bytes, 'A senha deve ter no máximo 72 bytes em UTF-8.'),
});

export const rfidScanSchema = z.object({
  token: z.string().trim().regex(/^[0-9a-f]{32}$/i, 'Token de cartão inválido.'),
});

export const rfidSessionSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Código de sessão RFID inválido.'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type AlterarSenhaInput = z.infer<typeof alterarSenhaSchema>;
export type RfidScanInput = z.infer<typeof rfidScanSchema>;
export type RfidSessionInput = z.infer<typeof rfidSessionSchema>;
