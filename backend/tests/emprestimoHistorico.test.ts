import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import { emprestimoListQuerySchema } from '../src/schemas/emprestimo.schema.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'synthetic-history-test-secret-0123456789abcdef';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------------------------------------------------------------------------------------------------------------
// Query schema

describe('emprestimoListQuerySchema', () => {
  const ok = (query: Record<string, unknown>) => {
    const result = emprestimoListQuerySchema.safeParse(query);
    assert.equal(result.success, true, JSON.stringify(query));
    return result.data!;
  };
  const rejeita = (query: Record<string, unknown>, campo?: string) => {
    const result = emprestimoListQuerySchema.safeParse(query);
    assert.equal(result.success, false, JSON.stringify(query));
    if (campo) assert.ok(result.error!.issues.some((issue) => issue.path.join('.') === campo), `expected an issue on ${campo}`);
  };

  it('keeps the legacy defaults and bounds', () => {
    assert.deepEqual(ok({}), { limit: 50 });
    assert.deepEqual(ok({ limit: '100', cursor: '42' }), { limit: 100, cursor: 42 });
    rejeita({ limit: '0' });
    rejeita({ limit: '101' });
    rejeita({ cursor: '0' });
    rejeita({ cursor: '2147483648' });
  });

  it('is strict: unknown parameters are rejected', () => {
    rejeita({ pageSize: '10' });
    rejeita({ responsavelId: '1' });
  });

  it('accepts paginado only as 1 or true', () => {
    assert.equal(ok({ paginado: '1' }).paginado, true);
    assert.equal(ok({ paginado: 'true' }).paginado, true);
    rejeita({ paginado: '0' }, 'paginado');
    rejeita({ paginado: 'false' }, 'paginado');
    rejeita({ paginado: 'yes' }, 'paginado');
  });

  it('accepts status ABERTO or DEVOLVIDO only (single value, exact case)', () => {
    assert.equal(ok({ status: 'ABERTO' }).status, 'ABERTO');
    assert.equal(ok({ status: 'DEVOLVIDO' }).status, 'DEVOLVIDO');
    rejeita({ status: 'aberto' }, 'status');
    rejeita({ status: 'CANCELADO' }, 'status');
    rejeita({ status: ['ABERTO', 'DEVOLVIDO'] }, 'status');
  });

  it('turns a plain date into whole-UTC-day bounds and keeps explicit date-times', () => {
    const dia = ok({ de: '2026-11-01', ate: '2026-11-01' });
    assert.equal(dia.de!.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(dia.ate!.toISOString(), '2026-11-01T23:59:59.999Z');
    const local = ok({ de: '2026-11-01T00:00:00-03:00', ate: '2026-11-01T23:59:59.999-03:00' });
    assert.equal(local.de!.toISOString(), '2026-11-01T03:00:00.000Z');
    assert.equal(local.ate!.toISOString(), '2026-11-02T02:59:59.999Z');
    assert.equal(ok({ de: '2026-11-01T10:00:00Z' }).ate, undefined);
  });

  it('rejects invalid dates and de after ate', () => {
    rejeita({ de: '01/11/2026' }, 'de');
    rejeita({ de: '2026-02-30' }, 'de');
    rejeita({ ate: '2026-11-01T10:00:00' }, 'ate'); // no offset: ambiguous
    rejeita({ ate: 'x'.repeat(41) }, 'ate');
    rejeita({ de: '2026-11-02', ate: '2026-11-01' }, 'ate');
    rejeita({ de: '2026-11-01T12:00:00Z', ate: '2026-11-01T11:59:59Z' }, 'ate');
  });

  it('trims q, ignores a blank q and bounds its length', () => {
    assert.equal(ok({ q: '  Tablet ' }).q, 'Tablet');
    assert.equal(ok({ q: '   ' }).q, undefined);
    rejeita({ q: 'a'.repeat(101) }, 'q');
    rejeita({ q: ['a', 'b'] }, 'q');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Service and controller with the Prisma delegates swapped for an in-memory table (no database needed).

type Modules = {
  prisma: typeof import('../src/lib/prisma.js')['prisma'];
  signToken: typeof import('../src/lib/jwt.js')['signToken'];
  service: typeof import('../src/services/emprestimo.service.js');
  responsaveis: typeof import('../src/services/responsavel.service.js');
};
let m: Modules;
let server: Server;
let baseUrl: string;
const restauracoes: Array<() => void> = [];

function substituir(alvo: object, chave: string, valor: unknown): void {
  const original = (alvo as Record<string, unknown>)[chave];
  Object.defineProperty(alvo, chave, { value: valor, configurable: true, writable: true, enumerable: true });
  restauracoes.push(() => { Object.defineProperty(alvo, chave, { value: original, configurable: true, writable: true, enumerable: true }); });
}

/** Evaluates the subset of Prisma's where syntax the loan list builds. */
function avaliar(row: Any, where: Any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([chave, cond]: [string, Any]) => {
    if (chave === 'AND') return cond.every((w: Any) => avaliar(row, w));
    if (chave === 'OR') return cond.some((w: Any) => avaliar(row, w));
    const valor = row[chave];
    if (cond && typeof cond === 'object' && 'some' in cond) return valor.some((item: Any) => avaliar(item, cond.some));
    if (cond instanceof Date) return valor.getTime() === cond.getTime();
    if (cond && typeof cond === 'object') {
      if ('contains' in cond) {
        assert.equal(cond.mode, 'insensitive');
        return String(valor).toLowerCase().includes(String(cond.contains).toLowerCase());
      }
      const ops = ['lt', 'lte', 'gt', 'gte'].filter((op) => op in cond);
      if (ops.length) {
        const n = (v: Any) => (v instanceof Date ? v.getTime() : v);
        return ops.every((op) => ({ lt: n(valor) < n(cond.lt), lte: n(valor) <= n(cond.lte), gt: n(valor) > n(cond.gt), gte: n(valor) >= n(cond.gte) } as Any)[op]);
      }
      return avaliar(valor, cond); // to-one relation filter
    }
    return valor === cond;
  });
}

function ordenar(rows: Any[], orderBy: Any): Any[] {
  const criterios: Array<[string, 'asc' | 'desc']> = (Array.isArray(orderBy) ? orderBy : [orderBy]).map((o: Any) => Object.entries(o)[0] as Any);
  const n = (v: Any) => (v instanceof Date ? v.getTime() : v);
  return [...rows].sort((a, b) => {
    for (const [campo, dir] of criterios) {
      const d = n(a[campo]) - n(b[campo]);
      if (d !== 0) return dir === 'asc' ? d : -d;
    }
    return 0;
  });
}

const autor = { id: 7, nome: 'Autora Sintética' };
const AUTHOR_KEYS = ['criadoPor', 'criadoPorId', 'atualizadoPor', 'atualizadoPorId', 'atualizadoEm', 'devolvidoPor', 'devolvidoPorId'];

function emprestimo(id: number, dataRetirada: string, extra: Partial<Any> = {}): Any {
  return {
    id, solicitanteNome: `Pessoa ${id}`, responsavelId: 1, status: 'DEVOLVIDO', dataRetirada: new Date(dataRetirada),
    dataDevolucao: null, observacao: 'nota privada', createdAt: new Date(dataRetirada),
    criadoPorId: 7, atualizadoPorId: null, atualizadoEm: null, devolvidoPorId: null,
    criadoPor: autor, atualizadoPor: null, devolvidoPor: null,
    responsavel: { id: 1, nome: 'Coordenação Geral', cargo: 'Coordenação', ativo: true },
    itens: [{ id: id * 10, emprestimoId: id, equipamentoId: 1, quantidade: 1, equipamento: { id: 1, modelo: 'Tablet', categoria: { id: 1, nome: 'TI' } } }],
    ...extra,
  };
}

let tabela: Any[];
let findManyCalls: Any[];
let findUniqueCalls: Any[];

before(async () => {
  const [{ prisma }, { signToken }, service, responsaveis, { emprestimosRouter }, { errorHandler }] = await Promise.all([
    import('../src/lib/prisma.js'),
    import('../src/lib/jwt.js'),
    import('../src/services/emprestimo.service.js'),
    import('../src/services/responsavel.service.js'),
    import('../src/routes/emprestimos.js'),
    import('../src/middlewares/errorHandler.js'),
  ]);
  m = { prisma, signToken, service, responsaveis };
  const app = express();
  app.use('/emprestimos', emprestimosRouter);
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  findManyCalls = [];
  findUniqueCalls = [];
  // Ties on dataRetirada (ids 2/3/4 and 6/7) exercise the id tie-breaker; ids are deliberately not in date order.
  tabela = [
    emprestimo(1, '2026-10-01T10:00:00.000Z'),
    emprestimo(2, '2026-10-05T10:00:00.000Z', { status: 'ABERTO' }),
    emprestimo(3, '2026-10-05T10:00:00.000Z'),
    emprestimo(4, '2026-10-05T10:00:00.000Z', { solicitanteNome: 'Maria Souza' }),
    emprestimo(5, '2026-09-20T10:00:00.000Z', { status: 'ABERTO' }),
    emprestimo(6, '2026-11-01T10:00:00.000Z', { responsavel: { id: 2, nome: 'Direção Escolar', cargo: 'Direção', ativo: false } }),
    emprestimo(7, '2026-11-01T10:00:00.000Z', {
      itens: [{ id: 70, emprestimoId: 7, equipamentoId: 2, quantidade: 1, equipamento: { id: 2, modelo: 'Projetor Epson', categoria: { id: 1, nome: 'TI' } } }],
    }),
    emprestimo(8, '2026-10-20T10:00:00.000Z', { status: 'ABERTO' }),
  ];
  substituir(m.prisma, 'usuario', { findUnique: async () => ({ id: 42, nivelAcesso: 'EDITOR', sessionVersion: 0, ativo: true }) });
  substituir(m.prisma, 'emprestimo', {
    findMany: async (args: Any) => {
      findManyCalls.push(args);
      const filtradas = ordenar(tabela.filter((row) => avaliar(row, args.where)), args.orderBy);
      return args.take === undefined ? filtradas : filtradas.slice(0, args.take);
    },
    findUnique: async (args: Any) => {
      findUniqueCalls.push(args);
      const row = tabela.find((r) => r.id === args.where.id);
      return row ? { id: row.id, dataRetirada: row.dataRetirada } : null;
    },
  });
});

afterEach(() => {
  while (restauracoes.length) restauracoes.pop()!();
});

async function get(path: string, autenticado: boolean) {
  const headers: Record<string, string> = autenticado
    ? { authorization: `Bearer ${m.signToken({ sub: 42, nivelAcesso: 'EDITOR' })}` }
    : {};
  const resposta = await fetch(`${baseUrl}${path}`, { headers });
  return { status: resposta.status, body: await resposta.json() as Any };
}

const ids = (lista: Any[]) => lista.map((item) => item.id);

describe('loan list filters (service)', () => {
  it('builds no condition without filters and one AND-condition per filter', () => {
    assert.deepEqual(m.service.condicoesFiltroEmprestimos({}), []);
    const de = new Date('2026-10-01T00:00:00Z');
    const ate = new Date('2026-10-31T23:59:59.999Z');
    assert.deepEqual(m.service.condicoesFiltroEmprestimos({ status: 'ABERTO', de, ate, q: 'tab' }), [
      { status: 'ABERTO' },
      { dataRetirada: { gte: de, lte: ate } },
      { OR: [
        { solicitanteNome: { contains: 'tab', mode: 'insensitive' } },
        { responsavel: { nome: { contains: 'tab', mode: 'insensitive' } } },
        { itens: { some: { equipamento: { modelo: { contains: 'tab', mode: 'insensitive' } } } } },
      ] },
    ]);
    assert.deepEqual(m.service.condicoesFiltroEmprestimos({ ate }), [{ dataRetirada: { lte: ate } }]);
  });

  it('pages newest first with a stable keyset cursor across dataRetirada ties and concurrent inserts', async () => {
    const vistos: number[] = [];
    let cursor: number | undefined;
    let paginas = 0;
    do {
      const pagina = await m.service.listarPaginaEmprestimos({ limit: 2, cursor });
      vistos.push(...ids(pagina.items));
      cursor = pagina.nextCursor ?? undefined;
      if (paginas === 0) {
        // A loan created between page requests (newest dataRetirada) must not shift the following pages.
        tabela.push(emprestimo(9, '2026-11-13T10:00:00.000Z'));
      }
      paginas += 1;
    } while (cursor !== undefined && paginas < 20);
    assert.deepEqual(vistos, [7, 6, 8, 4, 3, 2, 1, 5]);
    assert.equal(paginas, 4);
    const args = findManyCalls.at(-1);
    assert.deepEqual(args.orderBy, [{ dataRetirada: 'desc' }, { id: 'desc' }]);
    assert.equal(args.take, 3);
    assert.ok(args.include.criadoPor && args.include.devolvidoPor, 'authenticated page carries authorship');
  });

  it('applies filters together with the cursor', async () => {
    const primeira = await m.service.listarPaginaEmprestimos({ filtros: { status: 'ABERTO' }, limit: 1 });
    assert.deepEqual(ids(primeira.items), [8]);
    assert.equal(primeira.nextCursor, 8);
    const segunda = await m.service.listarPaginaEmprestimos({ filtros: { status: 'ABERTO' }, limit: 5, cursor: 8 });
    assert.deepEqual(ids(segunda.items), [2, 5]);
    assert.equal(segunda.nextCursor, null);
  });

  it('rejects an unknown cursor with a validation error', async () => {
    await assert.rejects(m.service.listarPaginaEmprestimos({ limit: 2, cursor: 999 }), (error: Any) => {
      assert.equal(error.status, 400);
      assert.equal(error.chaveI18n, 'backend.validacao.dados_invalidos');
      return true;
    });
  });

  it('never runs the text search on the guest page, even if a caller passes q', async () => {
    const pagina = await m.service.listarPaginaPublicaEmprestimos({ filtros: { q: 'Maria' }, limit: 50 });
    assert.equal(pagina.items.length, tabela.length);
    assert.equal(JSON.stringify(findManyCalls[0].where ?? {}).includes('Maria'), false);
    assert.equal(findManyCalls[0].include.criadoPor, undefined);
  });
});

describe('GET /emprestimos (controller)', () => {
  it('authenticated without parameters keeps the legacy full array and query', async () => {
    const { status, body } = await get('/emprestimos', true);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, tabela.length);
    assert.equal(findManyCalls.length, 1);
    const args = findManyCalls[0];
    assert.equal(args.where, undefined);
    assert.equal(args.take, undefined);
    assert.deepEqual(args.orderBy, { createdAt: 'desc' });
    assert.deepEqual(body[0].criadoPor, autor);
  });

  it('authenticated legacy mode ignores limit and cursor (deployed app compatibility)', async () => {
    const { status, body } = await get('/emprestimos?limit=1&cursor=3', true);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, tabela.length);
    assert.equal(findUniqueCalls.length, 0);
  });

  it('authenticated status=ABERTO without paginado returns the full array of open loans', async () => {
    const { status, body } = await get('/emprestimos?status=ABERTO', true);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.deepEqual(ids(body).sort(), [2, 5, 8]);
    assert.deepEqual(findManyCalls[0].where, { status: 'ABERTO' });
  });

  it('authenticated paginado=1 returns { items, nextCursor, limit } newest first with authorship', async () => {
    const { status, body } = await get('/emprestimos?paginado=1&limit=3', true);
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['items', 'limit', 'nextCursor']);
    assert.deepEqual(ids(body.items), [7, 6, 8]);
    assert.equal(body.nextCursor, 8);
    assert.equal(body.limit, 3);
    assert.deepEqual(body.items[0].criadoPor, autor);
    assert.equal(body.items[0].solicitanteNome, 'Pessoa 7');
    const seguinte = await get(`/emprestimos?paginado=true&limit=3&cursor=${body.nextCursor}`, true);
    assert.deepEqual(ids(seguinte.body.items), [4, 3, 2]);
    assert.equal(seguinte.body.nextCursor, 2);
    const fim = await get(`/emprestimos?paginado=1&limit=3&cursor=${seguinte.body.nextCursor}`, true);
    assert.deepEqual(ids(fim.body.items), [1, 5]);
    assert.equal(fim.body.nextCursor, null);
  });

  it('authenticated paginado applies status, date range and case-insensitive q', async () => {
    let r = await get('/emprestimos?paginado=1&de=2026-10-05&ate=2026-10-20', true);
    assert.deepEqual(ids(r.body.items), [8, 4, 3, 2]);
    r = await get('/emprestimos?paginado=1&status=DEVOLVIDO&de=2026-10-05', true);
    assert.deepEqual(ids(r.body.items), [7, 6, 4, 3]);
    r = await get('/emprestimos?paginado=1&q=maria', true);
    assert.deepEqual(ids(r.body.items), [4]);
    r = await get(`/emprestimos?paginado=1&q=${encodeURIComponent('DIREÇÃO')}`, true);
    assert.deepEqual(ids(r.body.items), [6]);
    r = await get('/emprestimos?paginado=1&q=epson', true);
    assert.deepEqual(ids(r.body.items), [7]);
    r = await get('/emprestimos?paginado=1&q=%20%20', true);
    assert.equal(r.body.items.length, tabela.length, 'blank q means no text filter');
  });

  it('rejects invalid queries with the validation error contract', async () => {
    for (const query of ['status=aberto', 'de=2026-11-02&ate=2026-11-01', 'paginado=0', 'limit=101', 'foo=1']) {
      const { status, body } = await get(`/emprestimos?${query}`, true);
      assert.equal(status, 400, query);
      assert.equal(body.erro, 'backend.validacao.dados_invalidos');
      assert.ok(Array.isArray(body.detalhes) && body.detalhes.length > 0);
    }
    const desconhecido = await get('/emprestimos?paginado=1&cursor=999', true);
    assert.equal(desconhecido.status, 400);
    assert.deepEqual(desconhecido.body.detalhes, [{ campo: 'cursor', mensagem: 'Cursor de paginação desconhecido.' }]);
    assert.equal(findManyCalls.length, 0);
  });

  it('guest gets masked pages in history order with status/date filters and no authorship', async () => {
    const { status, body } = await get('/emprestimos?limit=2', false);
    assert.equal(status, 200);
    assert.deepEqual(ids(body.items), [7, 6]);
    assert.equal(body.nextCursor, 6);
    assert.equal(body.limit, 2);
    for (const item of body.items) {
      assert.equal(item.solicitanteNome, 'Convidado');
      assert.equal(item.responsavel, null);
      assert.equal(item.observacao, null);
      for (const chave of AUTHOR_KEYS) assert.equal(chave in item, false, `guest item leaked ${chave}`);
    }
    assert.equal(findManyCalls[0].include.criadoPor, undefined);
    const seguinte = await get(`/emprestimos?limit=2&cursor=${body.nextCursor}`, false);
    assert.deepEqual(ids(seguinte.body.items), [8, 4]);
    const filtrada = await get('/emprestimos?status=ABERTO&de=2026-10-01&ate=2026-10-31&paginado=1', false);
    assert.equal(filtrada.status, 200);
    assert.deepEqual(ids(filtrada.body.items), [8, 2]);
  });

  it('guest text search is rejected before any query, blank or not', async () => {
    for (const q of ['Maria', '', '%20']) {
      const { status, body } = await get(`/emprestimos?q=${q}`, false);
      assert.equal(status, 400);
      assert.equal(body.erro, 'backend.validacao.dados_invalidos');
      assert.deepEqual(body.detalhes, [{ campo: 'q', mensagem: 'A busca por texto exige autenticação.' }]);
    }
    assert.equal(findManyCalls.length, 0);
  });
});

describe('GET /responsaveis service', () => {
  it('lists everyone only when incluirInativos is requested, each row with its ativo flag', async () => {
    let args: Any;
    const linhas = [
      { id: 1, nome: 'Ana', cargo: 'Coordenação', ativo: true, criadoPorId: null, criadoPor: null },
      { id: 2, nome: 'Bruno', cargo: 'Direção', ativo: false, criadoPorId: null, criadoPor: null },
    ];
    substituir(m.prisma, 'responsavel', { findMany: async (a: Any) => { args = a; return linhas; } });
    const lista = await m.responsaveis.listarResponsaveis(true);
    assert.equal(args.where, undefined, 'no ativo filter when inactive people are included');
    assert.equal(args.select, undefined, 'all scalar columns (including ativo) are returned');
    assert.deepEqual(lista.map((r) => [r.id, r.ativo]), [[1, true], [2, false]]);
  });
});
