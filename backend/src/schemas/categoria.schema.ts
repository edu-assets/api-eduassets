import { z } from 'zod';

export const categoriaCreateSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório.').max(100),
});

export const categoriaUpdateSchema = z.object({
  nome: z.string().trim().min(1, 'Nome é obrigatório.').max(100),
}).strict();

export type CategoriaUpdateInput = z.infer<typeof categoriaUpdateSchema>;
export type CategoriaCreateInput = z.infer<typeof categoriaCreateSchema>;
