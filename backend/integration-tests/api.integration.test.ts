import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import bcrypt from 'bcrypt';
import { after, before, test } from 'node:test';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const marker = `it-${Date.now()}-${process.pid}`;
const login = `${marker}@example.invalid`;
const password = 'Synthetic-Integration-Password-01';
const rows: { categoryId?: number; responsibleId?: number; equipmentId?: number; userId?: number; loanIds: number[]; occurrenceIds: number[] } = { loanIds: [], occurrenceIds: [] };
let server: Server;
let baseUrl: string;
let adminToken = '';

type Json = Record<string, unknown>;
async function api(path: string, init: RequestInit = {}, token?: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json();
  return { status: response.status, body };
}
function json(method: string, value?: unknown): RequestInit {
  return { method, ...(value === undefined ? {} : { body: JSON.stringify(value) }) };
}

before(async () => {
  const category = await prisma.categoria.create({ data: { nome: `Synthetic ${marker}` } });
  rows.categoryId = category.id;
  const responsible = await prisma.responsavel.create({ data: { nome: 'Synthetic Responsible', cargo: 'Test fixture' } });
  rows.responsibleId = responsible.id;
  const equipment = await prisma.equipamento.create({
    data: { categoriaId: category.id, modelo: `Synthetic equipment ${marker}`, quantidadeTotal: 10, quantidadeDisponivel: 10 },
  });
  rows.equipmentId = equipment.id;
  const passwordHash = await bcrypt.hash(password, 4);
  const user = await prisma.usuario.create({
    data: { nome: 'Synthetic Administrator', login, passwordHash, nivelAcesso: 'ADMINISTRADOR' },
  });
  rows.userId = user.id;

  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Integration test HTTP server failed to bind.');
  baseUrl = `http://127.0.0.1:${address.port}`;
  const loginResult = await api('/auth/login', json('POST', { login, password }));
  assert.equal(loginResult.status, 200);
  adminToken = loginResult.body.token;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (rows.loanIds.length) {
    await prisma.itemEmprestimo.deleteMany({ where: { emprestimoId: { in: rows.loanIds } } });
    await prisma.emprestimo.deleteMany({ where: { id: { in: rows.loanIds } } });
  }
  if (rows.occurrenceIds.length) await prisma.ocorrencia.deleteMany({ where: { id: { in: rows.occurrenceIds } } });
  if (rows.equipmentId) await prisma.equipamento.delete({ where: { id: rows.equipmentId } });
  if (rows.responsibleId) await prisma.responsavel.delete({ where: { id: rows.responsibleId } });
  if (rows.categoryId) await prisma.categoria.delete({ where: { id: rows.categoryId } });
  if (rows.userId) await prisma.usuario.delete({ where: { id: rows.userId } });
  await prisma.$disconnect();
});

test('Guest Mode has endpoint-specific allowlists and cannot mutate records', async () => {
  const sampleLoan = await api('/emprestimos', json('POST', {
    solicitanteNome: `Synthetic borrower ${marker}`, responsavelId: rows.responsibleId,
    observacao: `Synthetic private note ${marker}`,
    itens: [{ equipamentoId: rows.equipmentId, quantidade: 1 }],
  }), adminToken);
  assert.equal(sampleLoan.status, 201);
  rows.loanIds.push(sampleLoan.body.id);
  const sampleOccurrence = await api('/ocorrencias', json('POST', {
    equipamentoId: rows.equipmentId, tipo: 'OBSERVACAO', problema: 'outro',
    descricao: `Synthetic incident note ${marker}`, numeros: [`OBS-${marker}`],
  }), adminToken);
  assert.equal(sampleOccurrence.status, 201);
  rows.occurrenceIds.push(sampleOccurrence.body[0].id);

  const loans = await api('/emprestimos');
  assert.equal(loans.status, 200);
  const loan = loans.body.find((item: Json) => item.id && (item as any).itens?.some((line: any) => line.equipamentoId === rows.equipmentId));
  if (loan) {
    assert.equal(loan.solicitanteNome, 'Convidado');
    assert.equal(loan.observacao, null);
    assert.equal(loan.responsavel, null);
    assert.equal('passwordHash' in loan, false);
  }
  const equipment = await api('/equipamentos');
  const publicEquipment = equipment.body.find((item: Json) => item.id === rows.equipmentId);
  assert.equal(publicEquipment.modelo, `Synthetic equipment ${marker}`);
  assert.equal('categoriaId' in publicEquipment, false);
  const occurrences = await api('/ocorrencias');
  assert.equal(occurrences.status, 200);
  const publicOccurrence = occurrences.body.find((item: Json) => item.id === rows.occurrenceIds[0]);
  assert.equal(publicOccurrence.numero, null);
  assert.equal(publicOccurrence.descricao, '');
  assert.equal(publicOccurrence.medidasTomadas, null);
  assert.equal(publicOccurrence.problema, 'Detalhes restritos');
  assert.equal(JSON.stringify(publicOccurrence).includes(`Synthetic incident note ${marker}`), false);
  const guestMutation = await api('/emprestimos', json('POST', { solicitanteNome: 'Synthetic', responsavelId: rows.responsibleId, itens: [{ equipamentoId: rows.equipmentId, quantidade: 1 }] }));
  assert.equal(guestMutation.status, 401);
  const privatePeople = await api('/responsaveis');
  assert.equal(privatePeople.status, 401);
  await api(`/emprestimos/${sampleLoan.body.id}/devolver`, json('PATCH', { dataDevolucao: new Date().toISOString() }), adminToken);
});

test('invalid current password is a business error and the authenticated JWT remains valid', async () => {
  const response = await api('/auth/senha', json('PATCH', { senhaAtual: 'wrong-password', novaSenha: 'new-password-123' }), adminToken);
  assert.equal(response.status, 422);
  const stillValid = await api('/auth/me', {}, adminToken);
  assert.equal(stillValid.status, 200);
  const invalid = await api('/auth/me', {}, 'not-a-jwt');
  assert.equal(invalid.status, 401);
  const missing = await api('/auth/me');
  assert.equal(missing.status, 401);
});

test('two simultaneous return requests release stock exactly once', async () => {
  const created = await api('/emprestimos', json('POST', {
    solicitanteNome: `Synthetic borrower ${marker}`, responsavelId: rows.responsibleId,
    observacao: `Synthetic private note ${marker}`,
    itens: [{ equipamentoId: rows.equipmentId, quantidade: 2 }],
  }), adminToken);
  assert.equal(created.status, 201);
  const id = created.body.id;
  rows.loanIds.push(id);
  const [first, second] = await Promise.all([
    api(`/emprestimos/${id}/devolver`, json('PATCH', { dataDevolucao: new Date().toISOString() }), adminToken),
    api(`/emprestimos/${id}/devolver`, json('PATCH', { dataDevolucao: new Date().toISOString() }), adminToken),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const equipment = await prisma.equipamento.findUniqueOrThrow({ where: { id: rows.equipmentId } });
  assert.equal(equipment.quantidadeDisponivel, 10);
});

test('simultaneous loan edit and return preserve final stock and state', async () => {
  const created = await api('/emprestimos', json('POST', {
    solicitanteNome: `Synthetic race ${marker}`, responsavelId: rows.responsibleId,
    itens: [{ equipamentoId: rows.equipmentId, quantidade: 2 }],
  }), adminToken);
  assert.equal(created.status, 201);
  const id = created.body.id;
  rows.loanIds.push(id);
  const [edit, returned] = await Promise.all([
    api(`/emprestimos/${id}`, json('PATCH', { itens: [{ equipamentoId: rows.equipmentId, quantidade: 3 }] }), adminToken),
    api(`/emprestimos/${id}/devolver`, json('PATCH', { dataDevolucao: new Date().toISOString() }), adminToken),
  ]);
  assert.equal(returned.status, 200);
  assert.ok([200, 409].includes(edit.status));
  const record = await prisma.emprestimo.findUniqueOrThrow({ where: { id } });
  const equipment = await prisma.equipamento.findUniqueOrThrow({ where: { id: rows.equipmentId } });
  assert.equal(record.status, 'DEVOLVIDO');
  assert.equal(equipment.quantidadeDisponivel, 10);
});

test('simultaneous occurrence resolution changes inventory exactly once', async () => {
  const created = await api('/ocorrencias', json('POST', {
    equipamentoId: rows.equipmentId, tipo: 'QUEBRADO', problema: 'outro', descricao: `Synthetic detail ${marker}`, numeros: [`SER-${marker}`],
  }), adminToken);
  assert.equal(created.status, 201);
  const id = created.body[0].id;
  rows.occurrenceIds.push(id);
  const [first, second] = await Promise.all([
    api(`/ocorrencias/${id}/resolver`, json('PATCH', { medidasTomadas: 'Synthetic resolved' }), adminToken),
    api(`/ocorrencias/${id}/resolver`, json('PATCH', { medidasTomadas: 'Synthetic resolved' }), adminToken),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const equipment = await prisma.equipamento.findUniqueOrThrow({ where: { id: rows.equipmentId } });
  assert.equal(equipment.quantidadeDisponivel, 10);
  assert.equal(equipment.quantidadeQuebrada, 0);
});
