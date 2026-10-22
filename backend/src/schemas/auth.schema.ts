import { z } from 'zod';

export const loginSchema = z.object({
  login: z.string().trim().toLowerCase().min(1, 'Login é obrigatório.').max(200),
  password: z.string().min(1, 'Senha é obrigatória.').max(200),
});

export const alterarSenhaSchema = z.object({
  senhaAtual: z.string().min(1, 'Informe a senha atual.').max(200),
  novaSenha: z.string().min(8, 'A nova senha deve ter no mínimo 8 caracteres.').max(200),
});

export const rfidScanSchema = z.object({
  token: z.string().trim().regex(/^[0-9a-f]{32}$/i, 'Token de cartão inválido.'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type AlterarSenhaInput = z.infer<typeof alterarSenhaSchema>;
export type RfidScanInput = z.infer<typeof rfidScanSchema>;
