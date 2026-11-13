import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import bcrypt from 'bcrypt';
import { after, before, test } from 'node:test';
import { app } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { setMailSenderForTests, type MailMessage } from '../src/lib/mailer.js';

const marker = `it-${Date.now()}-${process.pid}`;
const login = `${marker}@example.invalid`;
const password = 'Synthetic-Integration-Password-01';
const integrationOrigin = process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()).find(Boolean) ?? 'http://127.0.0.1';
const rows: { categoryId?: number; responsibleId?: number; equipmentId?: number; secondEquipmentId?: number; userId?: number; targetUserId?: number; loanIds: number[]; occurrenceIds: number[];
  extraEquipmentIds: number[]; extraResponsibleIds: number[]; extraCategoryIds: number[] } = {
  loanIds: [], occurrenceIds: [], extraEquipmentIds: [], extraResponsibleIds: [], extraCategoryIds: [],
};
let server: Server;
let baseUrl: string;
let adminToken = '';

type Json = Record<string, unknown>;
async function api(path: string, init: RequestInit = {}, cookie?: string): Promise<{ status: number; body: any; sessionCookie?: string; cacheControl?: string }> {
  const method = (init.method ?? 'GET').toUpperCase();
  const checkAudit = Boolean(cookie && cookie === adminToken && rows.userId && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method));
  const auditCountBefore = checkAudit ? await prisma.auditLog.count({ where: { actorId: rows.userId! } }) : 0;
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      origin: integrationOrigin,
      ...(cookie ? { cookie } : {}),
      ...init.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json();
  if (checkAudit && response.status >= 200 && response.status < 400) {
    const auditCountAfter = await prisma.auditLog.count({ where: { actorId: rows.userId! } });
    assert.ok(auditCountAfter > auditCountBefore, `Expected an actor audit row for ${method} ${path}.`);
  }
  const sessionCookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  return { status: response.status, body, sessionCookie, cacheControl: response.headers.get('cache-control') ?? undefined };
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
  const secondEquipment = await prisma.equipamento.create({
    data: { categoriaId: category.id, modelo: `Synthetic equipment 2 ${marker}`, quantidadeTotal: 10, quantidadeDisponivel: 10 },
  });
  rows.secondEquipmentId = secondEquipment.id;
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
  assert.match(loginResult.cacheControl ?? '', /no-store/i);
  assert.equal('token' in loginResult.body, false);
  assert.match(loginResult.sessionCookie ?? '', /^(?:__Host-eduassets_session|eduassets_session)=/);
  adminToken = loginResult.sessionCookie ?? '';
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (rows.loanIds.length) {
    await prisma.itemEmprestimo.deleteMany({ where: { emprestimoId: { in: rows.loanIds } } });
    await prisma.emprestimo.deleteMany({ where: { id: { in: rows.loanIds } } });
  }
  if (rows.occurrenceIds.length) await prisma.ocorrencia.deleteMany({ where: { id: { in: rows.occurrenceIds } } });
  if (rows.extraEquipmentIds.length) await prisma.equipamento.deleteMany({ where: { id: { in: rows.extraEquipmentIds } } });
  if (rows.extraResponsibleIds.length) await prisma.responsavel.deleteMany({ where: { id: { in: rows.extraResponsibleIds } } });
  if (rows.extraCategoryIds.length) await prisma.categoria.deleteMany({ where: { id: { in: rows.extraCategoryIds } } });
  const actorIds = [rows.userId, rows.targetUserId].filter((id): id is number => id !== undefined);
  if (actorIds.length) await prisma.auditLog.deleteMany({ where: { actorId: { in: actorIds } } });
  if (rows.targetUserId) await prisma.usuario.delete({ where: { id: rows.targetUserId } });
  if (rows.secondEquipmentId) await prisma.equipamento.delete({ where: { id: rows.secondEquipmentId } });
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

  const loans = await api('/emprestimos?limit=1');
  assert.equal(loans.status, 200);
  assert.match(loans.cacheControl ?? '', /no-store/i);
  assert.ok(Array.isArray(loans.body.items));
  assert.ok(loans.body.items.length <= 1, 'Anonymous loan lists must be bounded by the requested page size.');
  assert.ok(loans.body.nextCursor === null || Number.isInteger(loans.body.nextCursor));
  const loan = loans.body.items.find((item: Json) => item.id && (item as any).itens?.some((line: any) => line.equipamentoId === rows.equipmentId));
  assert.ok(loan, 'Expected the synthetic loan to be visible in the Guest allowlisted response.');
  assert.equal(loan.solicitanteNome, 'Convidado');
  assert.equal(loan.observacao, null);
  assert.equal(loan.responsavel, null);
  assert.equal('passwordHash' in loan, false);
  assert.equal((await api('/emprestimos?limit=101')).status, 400);
  if (loans.body.nextCursor !== null) {
    const olderPage = await api(`/emprestimos?limit=1&cursor=${loans.body.nextCursor}`);
    assert.equal(olderPage.status, 200);
    assert.ok(olderPage.body.items.length <= 1);
    if (olderPage.body.items.length) {
      // History order: dataRetirada DESC, id DESC (the cursor is the last id of the previous page).
      const last = loans.body.items.at(-1);
      const next = olderPage.body.items[0];
      const lastTime = Date.parse(last.dataRetirada);
      const nextTime = Date.parse(next.dataRetirada);
      assert.ok(nextTime < lastTime || (nextTime === lastTime && next.id < last.id));
    }
  }
  const guestSearch = await api(`/emprestimos?q=${encodeURIComponent('Synthetic borrower')}`);
  assert.equal(guestSearch.status, 400, 'Guests cannot search personal names.');
  assert.deepEqual(guestSearch.body.detalhes, [{ campo: 'q', mensagem: 'A busca por texto exige autenticação.' }]);
  const guestOpen = await api('/emprestimos?status=ABERTO&limit=100');
  assert.equal(guestOpen.status, 200);
  assert.ok(guestOpen.body.items.every((item: Json) => item.status === 'ABERTO'));
  assert.ok(guestOpen.body.items.some((item: Json) => item.id === sampleLoan.body.id));
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

test('explicitly seeded administrator can authenticate in a configured integration environment', {
  skip: !process.env.SEED_ADMIN_EMAIL || !process.env.SEED_ADMIN_PASSWORD,
}, async () => {
  const result = await api('/auth/login', json('POST', {
    login: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.user.nivelAcesso, 'ADMINISTRADOR');
});

test('invalid current password is a business error and the authenticated cookie session remains valid', async () => {
  const response = await api('/auth/senha', json('PATCH', { senhaAtual: 'wrong-password', novaSenha: 'new-password-123' }), adminToken);
  assert.equal(response.status, 422);
  const stillValid = await api('/auth/me', {}, adminToken);
  assert.equal(stillValid.status, 200);
  const invalid = await api('/auth/me', {}, 'not-a-jwt');
  assert.equal(invalid.status, 401);
  const missing = await api('/auth/me');
  assert.equal(missing.status, 401);
});

test('admin user management writes audit rows and disables existing sessions immediately', async () => {
  const originalPassword = 'Synthetic-Editor-Password-01!';
  const replacementPassword = 'Synthetic-Editor-Password-02!';
  const created = await api('/usuarios', json('POST', {
    nome: 'Synthetic Editor', login: `editor-${marker}@example.invalid`, senha: originalPassword, nivelAcesso: 'EDITOR',
  }), adminToken);
  assert.equal(created.status, 201);
  rows.targetUserId = created.body.id;

  const originalLogin = await api('/auth/login', json('POST', { login: created.body.login, password: originalPassword }));
  assert.equal(originalLogin.status, 200);
  const reset = await api(`/usuarios/${rows.targetUserId}/password-reset`, json('POST', { senha: replacementPassword }), adminToken);
  assert.equal(reset.status, 204);
  assert.equal((await api('/auth/me', {}, originalLogin.sessionCookie)).status, 401);
  assert.equal((await api('/auth/login', json('POST', { login: created.body.login, password: originalPassword }))).status, 401);

  const replacementLogin = await api('/auth/login', json('POST', { login: created.body.login, password: replacementPassword }));
  assert.equal(replacementLogin.status, 200);
  const disabled = await api(`/usuarios/${rows.targetUserId}`, json('PATCH', { ativo: false }), adminToken);
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.ativo, false);
  assert.equal((await api('/auth/me', {}, replacementLogin.sessionCookie)).status, 401);
  assert.equal((await api('/auth/login', json('POST', { login: created.body.login, password: replacementPassword }))).status, 401);
});

test('rejects a 73-byte password with HTTP 400 before authentication', async () => {
  const result = await api('/auth/login', json('POST', { login, password: 'A'.repeat(73) }));
  assert.equal(result.status, 400);
});

test('password change revokes other sessions and renews only the current cookie', async () => {
  const priorToken = adminToken;
  const otherLogin = await api('/auth/login', json('POST', { login, password }));
  assert.equal(otherLogin.status, 200);

  const changed = await api('/auth/senha', json('PATCH', {
    senhaAtual: password,
    novaSenha: 'Synthetic-Updated-Password-02',
  }), adminToken);
  assert.equal(changed.status, 204);
  assert.equal(changed.body, null);
  assert.ok(changed.sessionCookie);
  adminToken = changed.sessionCookie ?? '';

  assert.equal((await api('/auth/me', {}, priorToken)).status, 401);
  assert.equal((await api('/auth/me', {}, otherLogin.sessionCookie)).status, 401);
  assert.equal((await api('/auth/me', {}, adminToken)).status, 200);

  const restored = await api('/auth/senha', json('PATCH', {
    senhaAtual: 'Synthetic-Updated-Password-02',
    novaSenha: password,
  }), adminToken);
  assert.equal(restored.status, 204);
  assert.equal(restored.body, null);
  adminToken = restored.sessionCookie ?? '';
});

test('logout revokes every JWT for the account', async () => {
  const loggedOutToken = adminToken;
  const otherLogin = await api('/auth/login', json('POST', { login, password }));
  assert.equal(otherLogin.status, 200);

  assert.equal((await api('/auth/logout', json('POST'), adminToken)).status, 204);
  assert.equal((await api('/auth/me', {}, loggedOutToken)).status, 401);
  assert.equal((await api('/auth/me', {}, otherLogin.sessionCookie)).status, 401);

  const nextLogin = await api('/auth/login', json('POST', { login, password }));
  assert.equal(nextLogin.status, 200);
  assert.equal('token' in nextLogin.body, false);
  adminToken = nextLogin.sessionCookie ?? '';
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

test('equipment stock edits cannot reduce total below units held by open loans', async () => {
  const created = await api('/emprestimos', json('POST', {
    solicitanteNome: `Synthetic stock invariant ${marker}`, responsavelId: rows.responsibleId,
    itens: [{ equipamentoId: rows.equipmentId, quantidade: 2 }],
  }), adminToken);
  assert.equal(created.status, 201);
  rows.loanIds.push(created.body.id);

  const rejected = await api(`/equipamentos/${rows.equipmentId}`, json('PATCH', { quantidadeTotal: 1 }), adminToken);
  assert.equal(rejected.status, 409);
  const afterRejectedUpdate = await prisma.equipamento.findUniqueOrThrow({ where: { id: rows.equipmentId } });
  assert.equal(afterRejectedUpdate.quantidadeTotal, 10);
  assert.equal(afterRejectedUpdate.quantidadeDisponivel, 8);

  const returned = await api(`/emprestimos/${created.body.id}/devolver`, json('PATCH', { dataDevolucao: new Date().toISOString() }), adminToken);
  assert.equal(returned.status, 200);
});

test('crossed-order concurrent loans both succeed or return a conflict, never a generic failure', async () => {
  const firstItems = [
    { equipamentoId: rows.equipmentId!, quantidade: 2 },
    { equipamentoId: rows.secondEquipmentId!, quantidade: 2 },
  ];
  const secondItems = [...firstItems].reverse();
  const [first, second] = await Promise.all([
    api('/emprestimos', json('POST', { solicitanteNome: `Synthetic crossed A ${marker}`, responsavelId: rows.responsibleId, itens: firstItems }), adminToken),
    api('/emprestimos', json('POST', { solicitanteNome: `Synthetic crossed B ${marker}`, responsavelId: rows.responsibleId, itens: secondItems }), adminToken),
  ]);
  assert.ok([201, 409].includes(first.status));
  assert.ok([201, 409].includes(second.status));
  assert.ok(first.status === 201 || second.status === 201, 'At least one transaction should complete with the available stock.');
  const createdIds: number[] = [];
  if (first.status === 201) { rows.loanIds.push(first.body.id); createdIds.push(first.body.id); }
  if (second.status === 201) { rows.loanIds.push(second.body.id); createdIds.push(second.body.id); }
  for (const loanId of createdIds) {
    await api(`/emprestimos/${loanId}/devolver`, json('PATCH', { dataDevolucao: new Date().toISOString() }), adminToken);
  }
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

test('loan history: legacy array, open-loan array and filtered keyset pages per role', async () => {
  const historyName = `Synthetic history ${marker}`;
  const create = async (dataRetirada: string, equipamentoId: number) => {
    const created = await api('/emprestimos', json('POST', {
      solicitanteNome: historyName, responsavelId: rows.responsibleId, dataRetirada,
      itens: [{ equipamentoId, quantidade: 1 }],
    }), adminToken);
    assert.equal(created.status, 201);
    rows.loanIds.push(created.body.id);
    return created.body.id as number;
  };
  // b and c share dataRetirada: the id tie-breaker must order them c, b.
  const a = await create('2025-01-10T12:00:00.000Z', rows.secondEquipmentId!);
  const b = await create('2025-01-15T12:00:00.000Z', rows.equipmentId!);
  const c = await create('2025-01-15T12:00:00.000Z', rows.equipmentId!);
  const mine = (items: Json[]) => items.filter((item) => [a, b, c].includes(item.id as number)).map((item) => item.id);

  // Legacy contract of the deployed app: no parameters (and limit/cursor) -> full array.
  for (const path of ['/emprestimos', '/emprestimos?limit=1&cursor=1']) {
    const legacy = await api(path, {}, adminToken);
    assert.equal(legacy.status, 200);
    assert.ok(Array.isArray(legacy.body), `${path} must stay an array for authenticated users`);
    assert.deepEqual(mine(legacy.body).sort(), [a, b, c].sort());
  }
  const open = await api('/emprestimos?status=ABERTO', {}, adminToken);
  assert.equal(open.status, 200);
  assert.ok(Array.isArray(open.body));
  assert.ok(open.body.every((item: Json) => item.status === 'ABERTO'));
  assert.deepEqual(mine(open.body).sort(), [a, b, c].sort());

  const q = encodeURIComponent(historyName.toUpperCase());
  const first = await api(`/emprestimos?paginado=1&limit=2&q=${q}`, {}, adminToken);
  assert.equal(first.status, 200);
  assert.deepEqual(Object.keys(first.body).sort(), ['items', 'limit', 'nextCursor']);
  assert.deepEqual(first.body.items.map((item: Json) => item.id), [c, b]);
  assert.equal(first.body.nextCursor, b);
  assert.equal(first.body.limit, 2);
  assert.deepEqual(first.body.items[0].criadoPor, { id: rows.userId, nome: 'Synthetic Administrator' });
  assert.equal(first.body.items[0].solicitanteNome, historyName);
  const second = await api(`/emprestimos?paginado=1&limit=2&q=${q}&cursor=${first.body.nextCursor}`, {}, adminToken);
  assert.deepEqual(second.body.items.map((item: Json) => item.id), [a]);
  assert.equal(second.body.nextCursor, null);

  const day = await api(`/emprestimos?paginado=1&q=${q}&de=2025-01-15&ate=2025-01-15`, {}, adminToken);
  assert.deepEqual(day.body.items.map((item: Json) => item.id), [c, b]);
  const returnedOnly = await api(`/emprestimos?paginado=1&q=${q}&status=DEVOLVIDO`, {}, adminToken);
  assert.deepEqual(returnedOnly.body.items, []);
  const byEquipment = await api(`/emprestimos?paginado=1&limit=100&q=${encodeURIComponent(`equipment 2 ${marker}`)}`, {}, adminToken);
  assert.ok(byEquipment.body.items.some((item: Json) => item.id === a));
  assert.equal(byEquipment.body.items.some((item: Json) => item.id === b), false);
  assert.equal((await api('/emprestimos?paginado=1&de=2025-01-16&ate=2025-01-15', {}, adminToken)).status, 400);
  assert.equal((await api('/emprestimos?paginado=1&cursor=2147483647', {}, adminToken)).status, 400);

  // Guest: same pages and filters, masked DTO, no text search.
  const guestDay = await api('/emprestimos?status=ABERTO&de=2025-01-15T00:00:00Z&ate=2025-01-15T23:59:59.999Z&limit=100');
  assert.equal(guestDay.status, 200);
  assert.deepEqual(mine(guestDay.body.items), [c, b]);
  assertNoAuthorship(guestDay.body);
  assert.equal(JSON.stringify(guestDay.body).includes(historyName), false);
  assert.equal((await api(`/emprestimos?paginado=1&q=${q}`)).status, 400);

  // Responsible people carry the additive ativo flag and the list still returns everyone.
  const people = await api('/responsaveis', {}, adminToken);
  assert.equal(people.status, 200);
  assert.equal(people.body.find((item: Json) => item.id === rows.responsibleId).ativo, true);

  for (const id of [a, b, c]) {
    const returned = await api(`/emprestimos/${id}/devolver`, json('PATCH', {}), adminToken);
    assert.equal(returned.status, 200);
  }
});

const AUTHOR_KEYS = ['criadoPor', 'criadoPorId', 'atualizadoPor', 'atualizadoPorId', 'atualizadoEm',
  'devolvidoPor', 'devolvidoPorId', 'resolvidoPor', 'resolvidoPorId'];
function assertNoAuthorship(value: unknown, path = 'body'): void {
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoAuthorship(item, `${path}[${index}]`)); return; }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assert.equal(AUTHOR_KEYS.includes(key), false, `Guest response leaked ${path}.${key}`);
      assertNoAuthorship(child, `${path}.${key}`);
    }
  }
}

test('record authorship is written on create/update/return/resolve and shown only to authenticated users', async () => {
  const author = { id: rows.userId, nome: 'Synthetic Administrator' };
  const isAuthor = (value: unknown) => {
    assert.deepEqual(value, author);
    assert.deepEqual(Object.keys(value as Json).sort(), ['id', 'nome'], 'author objects carry only id and nome');
  };

  const category = await api('/categorias', json('POST', { nome: `Synthetic authorship ${marker}` }), adminToken);
  assert.equal(category.status, 201);
  rows.extraCategoryIds.push(category.body.id);
  isAuthor(category.body.criadoPor);

  const responsible = await api('/responsaveis', json('POST', { nome: 'Synthetic Authorship Responsible', cargo: 'Test fixture' }), adminToken);
  assert.equal(responsible.status, 201);
  rows.extraResponsibleIds.push(responsible.body.id);
  isAuthor(responsible.body.criadoPor);

  const equipment = await api('/equipamentos', json('POST', {
    categoriaId: category.body.id, modelo: `Synthetic authorship equipment ${marker}`, quantidadeTotal: 5,
  }), adminToken);
  assert.equal(equipment.status, 201);
  const equipmentId: number = equipment.body.id;
  rows.extraEquipmentIds.push(equipmentId);
  isAuthor(equipment.body.criadoPor);
  assert.equal(equipment.body.atualizadoPor, null);

  const loan = await api('/emprestimos', json('POST', {
    solicitanteNome: `Synthetic authorship borrower ${marker}`, responsavelId: responsible.body.id,
    itens: [{ equipamentoId: equipmentId, quantidade: 1 }],
  }), adminToken);
  assert.equal(loan.status, 201);
  rows.loanIds.push(loan.body.id);
  isAuthor(loan.body.criadoPor);
  assert.equal(loan.body.atualizadoPor, null);
  assert.equal(loan.body.atualizadoEm, null);
  assert.equal(loan.body.devolvidoPor, null);

  const edited = await api(`/emprestimos/${loan.body.id}`, json('PATCH', { itens: [{ equipamentoId: equipmentId, quantidade: 2 }] }), adminToken);
  assert.equal(edited.status, 200);
  isAuthor(edited.body.atualizadoPor);
  assert.ok(!Number.isNaN(Date.parse(edited.body.atualizadoEm)), 'atualizadoEm must be an ISO timestamp');
  isAuthor(edited.body.criadoPor);

  const returned = await api(`/emprestimos/${loan.body.id}/devolver`, json('PATCH', { dataDevolucao: new Date().toISOString() }), adminToken);
  assert.equal(returned.status, 200);
  isAuthor(returned.body.devolvidoPor);

  const occurrence = await api('/ocorrencias', json('POST', {
    equipamentoId: equipmentId, tipo: 'MANUTENCAO', problema: 'outro', descricao: `Synthetic authorship ${marker}`, numeros: [`AUT-${marker}`],
  }), adminToken);
  assert.equal(occurrence.status, 201);
  const occurrenceId: number = occurrence.body[0].id;
  rows.occurrenceIds.push(occurrenceId);
  isAuthor(occurrence.body[0].criadoPor);
  assert.equal(occurrence.body[0].resolvidoPor, null);
  const occurrenceEdit = await api(`/ocorrencias/${occurrenceId}`, json('PATCH', { descricao: `Synthetic authorship edited ${marker}` }), adminToken);
  assert.equal(occurrenceEdit.status, 200);
  isAuthor(occurrenceEdit.body.atualizadoPor);
  assert.ok(!Number.isNaN(Date.parse(occurrenceEdit.body.atualizadoEm)));
  const resolved = await api(`/ocorrencias/${occurrenceId}/resolver`, json('PATCH', { medidasTomadas: 'Synthetic resolved' }), adminToken);
  assert.equal(resolved.status, 200);
  isAuthor(resolved.body.resolvidoPor);

  // Stock moves caused by loans and occurrences are not equipment edits (no Equipamento UPDATE audit row).
  const untouched = await prisma.equipamento.findUniqueOrThrow({ where: { id: equipmentId } });
  assert.equal(untouched.atualizadoPorId, null);
  const equipmentEdit = await api(`/equipamentos/${equipmentId}`, json('PATCH', { quantidadeTotal: 6 }), adminToken);
  assert.equal(equipmentEdit.status, 200);
  isAuthor(equipmentEdit.body.atualizadoPor);

  // Authenticated lists carry the same author objects.
  const staffLoans = await api('/emprestimos', {}, adminToken);
  const staffLoan = staffLoans.body.find((item: Json) => item.id === loan.body.id);
  isAuthor(staffLoan.criadoPor); isAuthor(staffLoan.atualizadoPor); isAuthor(staffLoan.devolvidoPor);
  const staffOccurrences = await api('/ocorrencias', {}, adminToken);
  const staffOccurrence = staffOccurrences.body.find((item: Json) => item.id === occurrenceId);
  isAuthor(staffOccurrence.criadoPor); isAuthor(staffOccurrence.atualizadoPor); isAuthor(staffOccurrence.resolvidoPor);
  const staffEquipment = (await api('/equipamentos', {}, adminToken)).body.find((item: Json) => item.id === equipmentId);
  isAuthor(staffEquipment.criadoPor); isAuthor(staffEquipment.atualizadoPor);
  isAuthor((await api('/categorias', {}, adminToken)).body.find((item: Json) => item.id === category.body.id).criadoPor);
  isAuthor((await api('/responsaveis', {}, adminToken)).body.find((item: Json) => item.id === responsible.body.id).criadoPor);
  const users = await api('/usuarios', {}, adminToken);
  assert.equal(users.status, 200);
  for (const user of users.body as Json[]) {
    assert.ok('criadoPor' in user && 'atualizadoPor' in user);
    for (const key of ['criadoPor', 'atualizadoPor']) {
      if (user[key] !== null) assert.deepEqual(Object.keys(user[key] as Json).sort(), ['id', 'nome']);
    }
  }

  // Guest Mode never receives authorship.
  for (const path of ['/emprestimos?limit=100', '/ocorrencias', '/equipamentos', '/categorias']) {
    const guest = await api(path);
    assert.equal(guest.status, 200);
    assertNoAuthorship(guest.body);
    assert.equal(JSON.stringify(guest.body).includes(author.nome), false, `${path} leaked an author name`);
  }
});

test('category rename and responsible deactivation: validation, conflicts, audit and loan guard', async () => {
  const category = await api('/categorias', json('POST', { nome: `Synthetic rename A ${marker}` }), adminToken);
  const other = await api('/categorias', json('POST', { nome: `Synthetic rename B ${marker}` }), adminToken);
  rows.extraCategoryIds.push(category.body.id, other.body.id);

  assert.equal((await api(`/categorias/${category.body.id}`, json('PATCH', { nome: 'x' }))).status, 401);
  assert.equal((await api(`/categorias/${category.body.id}`, json('PATCH', { nome: '   ' }), adminToken)).status, 400);
  assert.equal((await api(`/categorias/${category.body.id}`, json('PATCH', {}), adminToken)).status, 400);
  assert.equal((await api('/categorias/2147483646', json('PATCH', { nome: 'Nope' }), adminToken)).status, 404);
  const clash = await api(`/categorias/${category.body.id}`, json('PATCH', { nome: `Synthetic rename B ${marker}` }), adminToken);
  assert.equal(clash.status, 409);
  assert.equal(clash.body.erro, 'backend.categorias.nome_duplicado');
  const renamed = await api(`/categorias/${category.body.id}`, json('PATCH', { nome: `  Synthetic renamed ${marker}  ` }), adminToken);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.nome, `Synthetic renamed ${marker}`);
  assert.equal(await prisma.auditLog.count({ where: { entity: 'Categoria', entityId: String(category.body.id), action: 'UPDATE' } }), 1);

  const person = await api('/responsaveis', json('POST', { nome: 'Synthetic Toggle Responsible', cargo: 'Test fixture' }), adminToken);
  rows.extraResponsibleIds.push(person.body.id);
  const pid = person.body.id;
  assert.equal((await api(`/responsaveis/${pid}`, json('PATCH', { nome: 'x' }))).status, 401);
  assert.equal((await api(`/responsaveis/${pid}`, json('PATCH', {}), adminToken)).status, 400);
  assert.equal((await api(`/responsaveis/${pid}`, json('PATCH', { id: 1 }), adminToken)).status, 400);
  assert.equal((await api('/responsaveis/2147483646', json('PATCH', { ativo: false }), adminToken)).status, 404);

  const openLoan = await api('/emprestimos', json('POST', {
    solicitanteNome: `Synthetic inactive guard ${marker}`, responsavelId: pid, itens: [{ equipamentoId: rows.equipmentId, quantidade: 1 }],
  }), adminToken);
  assert.equal(openLoan.status, 201);
  rows.loanIds.push(openLoan.body.id);

  const off = await api(`/responsaveis/${pid}`, json('PATCH', { cargo: 'Synthetic new role', ativo: false }), adminToken);
  assert.equal(off.status, 200);
  assert.equal(off.body.ativo, false);
  assert.equal(off.body.cargo, 'Synthetic new role');
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { entity: 'Responsavel', entityId: String(pid), action: 'UPDATE' } });
  assert.deepEqual([...audit.changedFields].sort(), ['ativo', 'cargo']);

  const blocked = await api('/emprestimos', json('POST', {
    solicitanteNome: `Synthetic blocked ${marker}`, responsavelId: pid, itens: [{ equipamentoId: rows.equipmentId, quantidade: 1 }],
  }), adminToken);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.erro, 'backend.emprestimos.responsavel_inativo');

  // The default list hides inactive people; admins can opt in; the existing open loan is unaffected and can be returned.
  assert.equal((await api('/responsaveis', {}, adminToken)).body.some((item: Json) => item.id === pid), false);
  const all = await api('/responsaveis?incluirInativos=true', {}, adminToken);
  assert.equal(all.body.find((item: Json) => item.id === pid).ativo, false);
  assert.equal((await api(`/emprestimos/${openLoan.body.id}/devolver`, json('PATCH', {}), adminToken)).status, 200);

  assert.equal((await api(`/responsaveis/${pid}`, json('PATCH', { ativo: true }), adminToken)).body.ativo, true);
  assert.equal((await api('/responsaveis', {}, adminToken)).body.some((item: Json) => item.id === pid), true);
});

test('self-service password recovery sends a single-use link and revokes existing sessions', async () => {
  const recoveryLogin = `${marker}-recovery@example.invalid`;
  const user = await prisma.usuario.create({
    data: { nome: 'Synthetic <Recovery> User', login: recoveryLogin, passwordHash: await bcrypt.hash(password, 4), nivelAcesso: 'EDITOR' },
  });
  const sent: MailMessage[] = [];
  setMailSenderForTests(async (message) => { sent.push(message); });
  try {
    const before = await api('/auth/login', json('POST', { login: recoveryLogin, password }));
    assert.equal(before.status, 200);

    const capabilities = await api('/auth/session-capabilities');
    assert.equal(capabilities.body.passwordRecovery, true);

    const unknown = await api('/auth/senha/recuperar', json('POST', { login: `${marker}-nobody@example.invalid` }));
    const known = await api('/auth/senha/recuperar', json('POST', { login: recoveryLogin.toUpperCase(), idioma: 'en' }));
    assert.equal(unknown.status, 202);
    assert.equal(known.status, 202);
    assert.deepEqual(unknown.body, known.body, 'responses must not reveal whether the account exists');

    for (let i = 0; i < 50 && sent.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, recoveryLogin);
    assert.match(sent[0].subject, /Reset your eduAssets password/);
    assert.ok(sent[0].attachments?.some((file) => file.cid === 'eduassets-header'), 'header banner must be embedded inline');
    assert.match(sent[0].html, /Synthetic &lt;Recovery&gt; User/);
    const token = /#redefinir-senha=([A-Za-z0-9_-]{43})/.exec(sent[0].text)?.[1];
    assert.ok(token, 'email must contain a reset link');
    const stored = await prisma.passwordResetToken.findMany({ where: { usuarioId: user.id } });
    assert.equal(stored.length, 1);
    assert.notEqual(stored[0].tokenHash, token, 'only the token hash may be stored');

    const weak = await api('/auth/senha/redefinir', json('POST', { token, senha: 'weak' }));
    assert.equal(weak.status, 400);
    const newPassword = 'Synthetic-Recovered-Password-02';
    const reset = await api('/auth/senha/redefinir', json('POST', { token, senha: newPassword }));
    assert.equal(reset.status, 204);
    const reused = await api('/auth/senha/redefinir', json('POST', { token, senha: 'Synthetic-Another-Password-03' }));
    assert.equal(reused.status, 400);
    assert.equal(reused.body.erro, 'backend.auth.link_recuperacao_invalido');

    assert.equal((await api('/auth/me', {}, before.sessionCookie)).status, 401, 'existing sessions must be revoked');
    assert.equal((await api('/auth/login', json('POST', { login: recoveryLogin, password }))).status, 401);
    assert.equal((await api('/auth/login', json('POST', { login: recoveryLogin, password: newPassword }))).status, 200);
    const actions = (await prisma.auditLog.findMany({ where: { actorId: user.id } })).map((row) => row.action).sort();
    assert.deepEqual(actions.filter((action) => action.startsWith('PASSWORD_')), ['PASSWORD_RESET_REQUEST', 'PASSWORD_RESET_SELF']);
  } finally {
    setMailSenderForTests(null);
    await prisma.auditLog.deleteMany({ where: { actorId: user.id } });
    await prisma.usuario.delete({ where: { id: user.id } });
  }
});
