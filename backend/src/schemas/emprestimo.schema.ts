import { z } from 'zod';
import { MAX_DATABASE_INT, positiveDatabaseIdSchema, positiveInventoryCountSchema } from './common.schema.js';

export const itemEmprestimoSchema = z.object({
  equipamentoId: positiveDatabaseIdSchema,
  quantidade: positiveInventoryCountSchema,
});

export const emprestimoCreateSchema = z.object({
  solicitanteNome: z.string().trim().min(1, 'Nome do solicitante é obrigatório.').max(150),
  responsavelId: positiveDatabaseIdSchema,
  dataRetirada: z.string().min(1).max(64).refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida.').optional(),
  observacao: z.string().max(2000).optional(),
  itens: z.array(itemEmprestimoSchema).min(1, 'É necessário informar ao menos um item.').max(100, 'O empréstimo pode conter no máximo 100 itens.'),
});

export const emprestimoUpdateItensSchema = z.object({
  itens: z.array(itemEmprestimoSchema).min(1, 'É necessário informar ao menos um item.').max(100, 'O empréstimo pode conter no máximo 100 itens.'),
});

export type ItemEmprestimoSchemaInput = z.infer<typeof itemEmprestimoSchema>;
export type EmprestimoCreateSchemaInput = z.infer<typeof emprestimoCreateSchema>;
export type EmprestimoUpdateItensSchemaInput = z.infer<typeof emprestimoUpdateItensSchema>;

export const emprestimoListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().positive().max(MAX_DATABASE_INT).optional(),
}).strict();

export type EmprestimoListQuerySchemaInput = z.infer<typeof emprestimoListQuerySchema>;

export const emprestimoReturnSchema = z.object({
  dataDevolucao: z.string().max(40).datetime({ offset: true }).optional(),
});

export type EmprestimoReturnSchemaInput = z.infer<typeof emprestimoReturnSchema>;
