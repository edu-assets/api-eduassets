import { z } from 'zod';

export const ocorrenciaCreateSchema = z.object({
  equipamentoId: z.number().int().positive('Equipamento inválido.'),
  tipo: z.enum(['OBSERVACAO', 'MANUTENCAO', 'QUEBRADO'], {
    message: 'Tipo de ocorrência inválido.',
  }),
  problema: z.string().trim().min(1, 'Problema é obrigatório.').max(100),
  descricao: z.string().trim().min(1, 'Descrição é obrigatória.').max(2000),
  numeros: z.array(z.string().trim().min(1).max(50)).min(1, 'Informe ao menos um número de patrimônio/identificador.').max(100, 'Uma ocorrência pode conter no máximo 100 identificadores.'),
});

export const ocorrenciaUpdateSchema = z.object({
  problema: z.string().trim().min(1).max(100).optional(),
  descricao: z.string().trim().min(1).max(2000).optional(),
  numero: z.string().trim().max(50).optional(),
  medidasTomadas: z.string().trim().max(2000).optional(),
});

export const ocorrenciaResolverSchema = z.object({
  medidasTomadas: z.string().trim().min(1, 'Descreva as medidas tomadas.').max(2000),
});

export type OcorrenciaCreateSchemaInput = z.infer<typeof ocorrenciaCreateSchema>;
export type OcorrenciaUpdateSchemaInput = z.infer<typeof ocorrenciaUpdateSchema>;
export type OcorrenciaResolverSchemaInput = z.infer<typeof ocorrenciaResolverSchema>;
