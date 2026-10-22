import { z } from 'zod';

export const usuarioCreateSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório.').max(150),
  login: z.string().trim().toLowerCase().min(1, 'Login é obrigatório.').max(200),
  senha: z.string().min(12, 'A senha deve ter no mínimo 12 caracteres.').max(200),
  nivelAcesso: z.enum(['ADMINISTRADOR', 'EDITOR'], {
    message: 'Nível de acesso deve ser ADMINISTRADOR ou EDITOR.',
  }),
});

export type UsuarioCreateSchemaInput = z.infer<typeof usuarioCreateSchema>;
