import assert from 'node:assert/strict';
import test from 'node:test';
import { emprestimoCreateSchema } from '../src/schemas/emprestimo.schema.js';
import { equipamentoCreateSchema, equipamentoUpdateSchema } from '../src/schemas/equipamento.schema.js';
import { ocorrenciaCreateSchema } from '../src/schemas/ocorrencia.schema.js';

test('equipment schemas reject out-of-range database IDs and inventory counts', () => {
  const valid = { categoriaId: 1, modelo: 'Synthetic model', quantidadeTotal: 1_000_000 };
  assert.equal(equipamentoCreateSchema.safeParse(valid).success, true);
  assert.equal(equipamentoCreateSchema.safeParse({ ...valid, categoriaId: 2_147_483_648 }).success, false);
  assert.equal(equipamentoCreateSchema.safeParse({ ...valid, quantidadeTotal: 1_000_001 }).success, false);
  assert.equal(equipamentoUpdateSchema.safeParse({ quantidadeDisponivel: 1_000_001 }).success, false);
});

test('loan schema bounds quantities and date input length', () => {
  const base = { solicitanteNome: 'Synthetic borrower', responsavelId: 1, itens: [{ equipamentoId: 1, quantidade: 1 }] };
  assert.equal(emprestimoCreateSchema.safeParse(base).success, true);
  assert.equal(emprestimoCreateSchema.safeParse({ ...base, itens: [{ equipamentoId: 1, quantidade: 1_000_001 }] }).success, false);
  assert.equal(emprestimoCreateSchema.safeParse({ ...base, dataRetirada: 'x'.repeat(65) }).success, false);
});

test('occurrence schema rejects IDs beyond PostgreSQL Int', () => {
  const base = { equipamentoId: 2_147_483_648, tipo: 'OBSERVACAO', problema: 'Issue', descricao: 'Synthetic description', numeros: ['SER-1'] };
  assert.equal(ocorrenciaCreateSchema.safeParse(base).success, false);
});
