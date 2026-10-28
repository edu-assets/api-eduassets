import { z } from 'zod';

export const normalizarLogin = (login: string): string => login.trim().toLowerCase();

export const senhaForte = (senha: string): boolean =>
  Buffer.byteLength(senha, 'utf8') <= 72 && senha.length >= 12 && /[a-z]/.test(senha) && /[A-Z]/.test(senha) && /\d/.test(senha) && /[^A-Za-z0-9]/.test(senha);

const loginSchema = z.string().trim().min(1, 'Login é obrigatório.').max(200).transform(normalizarLogin);
const passwordSchema = z.string().refine(senhaForte, 'A senha deve ter 12 ou mais caracteres fortes e no máximo 72 bytes em UTF-8.');

export const usuarioCreateSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório.').max(150),
  login: loginSchema,
  senha: passwordSchema,
  nivelAcesso: z.enum(['ADMINISTRADOR', 'EDITOR'], {
    message: 'Nível de acesso deve ser ADMINISTRADOR ou EDITOR.',
  }),
}).strict();

export const usuarioUpdateSchema = z.object({
  nome: z.string().trim().min(1).max(150).optional(),
  login: loginSchema.optional(),
  nivelAcesso: z.enum(['ADMINISTRADOR', 'EDITOR']).optional(),
  ativo: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo para atualizar.');

export const usuarioPasswordResetSchema = z.object({ senha: passwordSchema }).strict();

export type UsuarioCreateSchemaInput = z.infer<typeof usuarioCreateSchema>;
export type UsuarioUpdateSchemaInput = z.infer<typeof usuarioUpdateSchema>;
