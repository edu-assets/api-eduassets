import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { categoriaUpdateSchema, responsavelUpdateSchema } from '../src/schemas/index.js';
import { AppError } from '../src/errors/AppError.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'synthetic-catalog-test-secret-0123456789abcdef';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('categoriaUpdateSchema', () => {
  it('trims and requires a non-empty nome', () => {
    assert.deepEqual(categoriaUpdateSchema.parse({ nome: '  Redes  ' }), { nome: 'Redes' });
    assert.equal(categoriaUpdateSchema.safeParse({}).success, false);
    assert.equal(categoriaUpdateSchema.safeParse({ nome: '   ' }).success, false);
    assert.equal(categoriaUpdateSchema.safeParse({ nome: 'x'.repeat(101) }).success, false);
  });
  it('is strict', () => {
    assert.equal(categoriaUpdateSchema.safeParse({ nome: 'Redes', criadoPorId: 1 }).success, false);
  });
});

describe('responsavelUpdateSchema', () => {
  it('accepts any non-empty subset and trims text', () => {
    assert.deepEqual(responsavelUpdateSchema.parse({ nome: ' Ana ' }), { nome: 'Ana' });
    assert.deepEqual(responsavelUpdateSchema.parse({ cargo: ' Direção ', ativo: false }), { cargo: 'Direção', ativo: false });
    assert.deepEqual(responsavelUpdateSchema.parse({ ativo: true }), { ativo: true });
  });
  it('requires at least one field', () => {
    assert.equal(responsavelUpdateSchema.safeParse({}).success, false);
    assert.equal(responsavelUpdateSchema.safeParse({ nome: undefined }).success, false);
  });
  it('rejects blank text, wrong types and unknown keys', () => {
    assert.equal(responsavelUpdateSchema.safeParse({ nome: '  ' }).success, false);
    assert.equal(responsavelUpdateSchema.safeParse({ cargo: '' }).success, false);
    assert.equal(responsavelUpdateSchema.safeParse({ ativo: 'false' }).success, false);
    assert.equal(responsavelUpdateSchema.safeParse({ nome: 'Ana', id: 3 }).success, false);
  });
});

type Modules = {
  prisma: typeof import('../src/lib/prisma.js')['prisma'];
  categorias: typeof import('../src/services/categoria.service.js');
  responsaveis: typeof import('../src/services/responsavel.service.js');
  emprestimos: typeof import('../src/services/emprestimo.service.js');
  ctrl: typeof import('../src/controllers/responsaveis.controller.js');
};
let m: Modules;
const restauracoes: Array<() => void> = [];

function substituir(alvo: object, chave: string, valor: unknown): void {
  const original = (alvo as Record<string, unknown>)[chave];
  Object.defineProperty(alvo, chave, { value: valor, configurable: true, writable: true, enumerable: true });
  restauracoes.push(() => { Object.defineProperty(alvo, chave, { value: original, configurable: true, writable: true, enumerable: true }); });
}

function criarTx(respostas: Record<string, (args: Any) => unknown>) {
  const chamadas: Array<{ op: string; args: Any }> = [];
  const tx = new Proxy({}, {
    get(_alvo, modelo: string) {
      if (modelo === '$queryRaw') return async () => [];
      return new Proxy({}, {
        get(_m, metodo: string) {
          return async (args: Any) => {
            const op = `${modelo}.${metodo}`;
            chamadas.push({ op, args });
            const resposta = respostas[op];
            if (resposta) return resposta(args);
            return {};
          };
        },
      });
    },
  });
  substituir(m.prisma, '$transaction', async (fn: Any) => fn(tx));
  return {
    chamadas,
    uma(op: string) {
      const encontradas = chamadas.filter((c) => c.op === op);
      assert.equal(encontradas.length, 1, `expected exactly one ${op}`);
      return encontradas[0].args;
    },
    tem: (op: string) => chamadas.some((c) => c.op === op),
  };
}

before(async () => {
  const [{ prisma }, categorias, responsaveis, emprestimos, ctrl] = await Promise.all([
    import('../src/lib/prisma.js'),
    import('../src/services/categoria.service.js'),
    import('../src/services/responsavel.service.js'),
    import('../src/services/emprestimo.service.js'),
    import('../src/controllers/responsaveis.controller.js'),
  ]);
  m = { prisma, categorias, responsaveis, emprestimos, ctrl };
});

afterEach(() => {
  while (restauracoes.length) restauracoes.pop()!();
});

const ACTOR = 5;

async function rejeitaCom(promessa: Promise<unknown>, status: number, chave: string) {
  await assert.rejects(promessa, (e: unknown) => e instanceof AppError && e.status === status && e.chaveI18n === chave);
}

describe('atualizarCategoria', () => {
  it('renames inside a transaction and writes an UPDATE audit row', async () => {
    const t = criarTx({ 'categoria.findUnique': () => ({ id: 4 }), 'categoria.update': () => ({ id: 4, nome: 'Redes' }) });
    const out = await m.categorias.atualizarCategoria(4, 'Redes', ACTOR);
    assert.equal(out.nome, 'Redes');
    assert.deepEqual(t.uma('categoria.update').where, { id: 4 });
    assert.deepEqual(t.uma('categoria.update').data, { nome: 'Redes' });
    assert.deepEqual(t.uma('auditLog.create').data, {
      actorId: ACTOR, action: 'UPDATE', entity: 'Categoria', entityId: '4', changedFields: ['nome'],
    });
  });
  it('404 when missing, without writing', async () => {
    const t = criarTx({ 'categoria.findUnique': () => null });
    await rejeitaCom(m.categorias.atualizarCategoria(99, 'X', ACTOR), 404, 'backend.categorias.nao_encontrada');
    assert.equal(t.tem('categoria.update'), false);
    assert.equal(t.tem('auditLog.create'), false);
  });
  it('409 on a unique-name collision', async () => {
    criarTx({
      'categoria.findUnique': () => ({ id: 4 }),
      'categoria.update': () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); },
    });
    await rejeitaCom(m.categorias.atualizarCategoria(4, 'Duplicada', ACTOR), 409, 'backend.categorias.nome_duplicado');
  });
});

describe('atualizarResponsavel', () => {
  it('updates only the supplied fields and audits them', async () => {
    const t = criarTx({ 'responsavel.findUnique': () => ({ id: 2 }), 'responsavel.update': () => ({ id: 2 }) });
    await m.responsaveis.atualizarResponsavel(2, { cargo: 'Direção', ativo: false }, ACTOR);
    assert.deepEqual(t.uma('responsavel.update').data, { cargo: 'Direção', ativo: false });
    assert.deepEqual(t.uma('auditLog.create').data, {
      actorId: ACTOR, action: 'UPDATE', entity: 'Responsavel', entityId: '2', changedFields: ['cargo', 'ativo'],
    });
  });
  it('404 when missing', async () => {
    const t = criarTx({ 'responsavel.findUnique': () => null });
    await rejeitaCom(m.responsaveis.atualizarResponsavel(9, { ativo: true }, ACTOR), 404, 'backend.responsaveis.nao_encontrado');
    assert.equal(t.tem('responsavel.update'), false);
  });
});

describe('GET /responsaveis filtering', () => {
  async function listar(nivelAcesso: 'ADMINISTRADOR' | 'EDITOR', query: Record<string, string>) {
    let args: Any;
    substituir(m.prisma, 'responsavel', { findMany: async (a: Any) => { args = a; return []; } });
    await m.ctrl.listar({ query, user: { sub: 1, nivelAcesso } } as Any, { json() {} } as Any);
    return args;
  }
  it('lists only active people by default', async () => {
    assert.deepEqual((await listar('ADMINISTRADOR', {})).where, { ativo: true });
    assert.deepEqual((await listar('EDITOR', {})).where, { ativo: true });
  });
  it('lets administrators include inactive people', async () => {
    assert.equal((await listar('ADMINISTRADOR', { incluirInativos: 'true' })).where, undefined);
  });
  it('ignores incluirInativos for editors and for non-true values', async () => {
    assert.deepEqual((await listar('EDITOR', { incluirInativos: 'true' })).where, { ativo: true });
    assert.deepEqual((await listar('ADMINISTRADOR', { incluirInativos: '1' })).where, { ativo: true });
  });
});

describe('criarEmprestimo with an inactive responsavel', () => {
  const dados = { solicitanteNome: 'X', responsavelId: 2, itens: [{ equipamentoId: 1, quantidade: 1 }] };
  it('is rejected with 409 before any stock or loan write', async () => {
    const t = criarTx({ 'responsavel.findUnique': () => ({ ativo: false }) });
    await rejeitaCom(m.emprestimos.criarEmprestimo(dados, ACTOR), 409, 'backend.emprestimos.responsavel_inativo');
    assert.equal(t.tem('emprestimo.create'), false);
    assert.equal(t.tem('auditLog.create'), false);
  });
  it('proceeds for an active responsavel', async () => {
    const t = criarTx({
      'responsavel.findUnique': () => ({ ativo: true }),
      'equipamento.findMany': () => [{ id: 1, modelo: 'T', quantidadeDisponivel: 10, categoria: { nome: 'C' } }],
      'equipamento.updateMany': () => ({ count: 1 }),
      'emprestimo.create': () => ({ id: 1, itens: [] }),
    });
    await m.emprestimos.criarEmprestimo(dados, ACTOR);
    assert.ok(t.tem('emprestimo.create'));
  });
});
