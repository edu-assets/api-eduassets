/**
 * Record authorship (who created/edited/returned/resolved a record) for AUTHENTICATED responses only.
 * The author is projected to { id, nome }: login (e-mail), access level and every other account field stay private.
 * Guest Mode DTOs (publicDto.ts) are allowlists and never carry these relations.
 */
export const autorSelect = { select: { id: true, nome: true } } as const;

export const autoriaCategoriaInclude = { criadoPor: autorSelect } as const;
export const autoriaResponsavelInclude = { criadoPor: autorSelect } as const;
export const autoriaEquipamentoInclude = { criadoPor: autorSelect, atualizadoPor: autorSelect } as const;
export const autoriaEmprestimoInclude = {
  criadoPor: autorSelect,
  atualizadoPor: autorSelect,
  devolvidoPor: autorSelect,
} as const;
export const autoriaOcorrenciaInclude = {
  criadoPor: autorSelect,
  atualizadoPor: autorSelect,
  resolvidoPor: autorSelect,
} as const;

export interface AutorResumo {
  id: number;
  nome: string;
}

/** Defensive projection: whatever the input carries, only id and nome leave the API. */
export function autorResumo(autor: { id: number; nome: string } | null | undefined): AutorResumo | null {
  return autor ? { id: autor.id, nome: autor.nome } : null;
}
