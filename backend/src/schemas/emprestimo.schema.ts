import { z } from 'zod';

export const itemEmprestimoSchema = z.object({
  equipamentoId: z.number().int().positive('Equipamento inválido.'),
  quantidade: z.number().int().positive('Quantidade deve ser no mínimo 1.'),
});

export const emprestimoCreateSchema = z.object({
  solicitanteNome: z.string().trim().min(1, 'Nome do solicitante é obrigatório.').max(150),
  responsavelId: z.number().int().positive('Responsável inválido.'),
  dataRetirada: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida.').optional(),
  observacao: z.string().max(2000).optional(),
  itens: z.array(itemEmprestimoSchema).min(1, 'É necessário informar ao menos um item.').max(100, 'O empréstimo pode conter no máximo 100 itens.'),
});

export const emprestimoUpdateItensSchema = z.object({
  itens: z.array(itemEmprestimoSchema).min(1, 'É necessário informar ao menos um item.').max(100, 'O empréstimo pode conter no máximo 100 itens.'),
});

export type ItemEmprestimoSchemaInput = z.infer<typeof itemEmprestimoSchema>;
export type EmprestimoCreateSchemaInput = z.infer<typeof emprestimoCreateSchema>;
export type EmprestimoUpdateItensSchemaInput = z.infer<typeof emprestimoUpdateItensSchema>;

export const emprestimoReturnSchema = z.object({
  dataDevolucao: z.string().datetime({ offset: true }).optional(),
});

export type EmprestimoReturnSchemaInput = z.infer<typeof emprestimoReturnSchema>;
