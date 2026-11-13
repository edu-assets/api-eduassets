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

const isoDateSchema = z.iso.date();
const isoDateTimeSchema = z.iso.datetime({ offset: true });

/**
 * A `de`/`ate` bound on dataRetirada. A plain AAAA-MM-DD is a whole UTC day (`de` from 00:00:00.000Z, `ate` up to
 * 23:59:59.999Z); clients that filter by a local calendar day send ISO 8601 date-times with an offset instead.
 */
function limiteDataRetirada(fimDoDia: boolean) {
  return z.string().max(40)
    .refine(
      (valor) => (isoDateSchema.safeParse(valor).success || isoDateTimeSchema.safeParse(valor).success) && !Number.isNaN(Date.parse(valor)),
      'Data inválida: use AAAA-MM-DD ou data e hora ISO 8601 com fuso.',
    )
    .transform((valor) => (isoDateSchema.safeParse(valor).success
      ? new Date(`${valor}T${fimDoDia ? '23:59:59.999' : '00:00:00.000'}Z`)
      : new Date(valor)));
}

/**
 * GET /emprestimos query. Without `paginado` an authenticated caller keeps the legacy full array (filters, if any,
 * still apply; limit/cursor are ignored as before). Guests are always paged and may not send `q`.
 */
export const emprestimoListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().positive().max(MAX_DATABASE_INT).optional(),
  paginado: z.enum(['1', 'true']).transform(() => true as const).optional(),
  status: z.enum(['ABERTO', 'DEVOLVIDO']).optional(),
  de: limiteDataRetirada(false).optional(),
  ate: limiteDataRetirada(true).optional(),
  /** Case-insensitive substring of solicitanteNome, responsavel.nome or an item's equipment modelo; blank = no filter. */
  q: z.string().max(100, 'A busca pode ter no máximo 100 caracteres.')
    .transform((valor) => valor.trim() || undefined)
    .optional(),
}).strict().refine((query) => !query.de || !query.ate || query.de.getTime() <= query.ate.getTime(), {
  message: 'A data inicial (de) deve ser anterior ou igual à data final (ate).',
  path: ['ate'],
});

export type EmprestimoListQuerySchemaInput = z.infer<typeof emprestimoListQuerySchema>;

export const emprestimoReturnSchema = z.object({
  dataDevolucao: z.string().max(40).datetime({ offset: true }).optional(),
});

export type EmprestimoReturnSchemaInput = z.infer<typeof emprestimoReturnSchema>;
