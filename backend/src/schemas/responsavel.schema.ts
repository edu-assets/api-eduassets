import { z } from 'zod';

export const responsavelCreateSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório.').max(150),
  cargo: z.string().trim().min(1, 'Cargo é obrigatório.').max(150),
});

export const responsavelUpdateSchema = z
  .object({
    nome: z.string().trim().min(1, 'Nome é obrigatório.').max(150).optional(),
    cargo: z.string().trim().min(1, 'Cargo é obrigatório.').max(150).optional(),
    ativo: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });

export type ResponsavelUpdateSchemaInput = z.infer<typeof responsavelUpdateSchema>;
export type ResponsavelCreateSchemaInput = z.infer<typeof responsavelCreateSchema>;
