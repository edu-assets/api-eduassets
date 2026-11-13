import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import {
  autorResumo, autorSelect,
  autoriaCategoriaInclude, autoriaEmprestimoInclude, autoriaEquipamentoInclude,
  autoriaOcorrenciaInclude, autoriaResponsavelInclude,
} from '../src/lib/authorship.js';
import { publicCategory, publicEquipment, publicLoan, publicOccurrence } from '../src/lib/publicDto.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'synthetic-authorship-test-secret-0123456789abcdef';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const AUTHOR_KEYS = [
  'criadoPor', 'criadoPorId', 'atualizadoPor', 'atualizadoPorId', 'atualizadoEm',
  'devolvidoPor', 'devolvidoPorId', 'resolvidoPor', 'resolvidoPorId',
];
/** What a careless query could return for an author: login and hash must never reach any response. */
const autorBruto = { id: 7, nome: 'Autora Sintética', login: 'autora@example.invalid', passwordHash: 'hash-privado' };
const autor = { id: 7, nome: 'Autora Sintética' };

function semAutoria(value: unknown, caminho = 'dto'): void {
  if (Array.isArray(value)) { value.forEach((item, i) => semAutoria(item, `${caminho}[${i}]`)); return; }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [chave, filho] of Object.entries(value)) {
      assert.equal(AUTHOR_KEYS.includes(chave), false, `${caminho}.${chave} must not be exposed to guests`);
      semAutoria(filho, `${caminho}.${chave}`);
    }
  }
}

const categoria = { id: 4, nome: 'Informática', criadoPorId: 7, criadoPor: autorBruto };
const equipamento = {
  id: 1, categoriaId: 4, modelo: 'Tablet', quantidadeTotal: 10, quantidadeDisponivel: 8, quantidadeQuebrada: 1,
  createdAt: new Date(), updatedAt: new Date(), criadoPorId: 7, atualizadoPorId: 7,
  criadoPor: autorBruto, atualizadoPor: autorBruto, categoria,
};
const emprestimo = {
  id: 12, solicitanteNome: 'Pessoa sintética', responsavelId: 2, status: 'DEVOLVIDO' as const,
  dataRetirada: new Date(), dataDevolucao: new Date(), observacao: 'nota privada', createdAt: new Date(),
  criadoPorId: 7, atualizadoPorId: 7, atualizadoEm: new Date(), devolvidoPorId: 7,
  criadoPor: autorBruto, atualizadoPor: autorBruto, devolvidoPor: autorBruto,
  responsavel: { id: 2, nome: 'Funcionário', cargo: 'Coordenação', criadoPorId: 7, criadoPor: autorBruto },
  itens: [{ id: 20, emprestimoId: 12, equipamentoId: 1, quantidade: 1, equipamento }],
};
const ocorrencia = {
  id: 8, equipamentoId: 1, numero: 'SERIAL-PRIVATE', tipo: 'MANUTENCAO' as const, status: 'RESOLVIDO' as const,
  problema: 'problema privado', descricao: 'detalhe privado', resolvidoEm: new Date(), medidasTomadas: 'nota privada',
  createdAt: new Date(), criadoPorId: 7, atualizadoPorId: 7, atualizadoEm: new Date(), resolvidoPorId: 7,
  criadoPor: autorBruto, atualizadoPor: autorBruto, resolvidoPor: autorBruto, equipamento,
};

describe('authorship projection (authenticated DTOs)', () => {
  it('selects only id and nome of the author account', () => {
    assert.deepEqual(autorSelect, { select: { id: true, nome: true } });
  });

  it('declares exactly the author relations of each entity, all through the id+nome projection', () => {
    const relacoes = (include: Record<string, unknown>) => {
      for (const valor of Object.values(include)) assert.equal(valor, autorSelect);
      return Object.keys(include).sort();
    };
    assert.deepEqual(relacoes(autoriaEmprestimoInclude), ['atualizadoPor', 'criadoPor', 'devolvidoPor']);
    assert.deepEqual(relacoes(autoriaOcorrenciaInclude), ['atualizadoPor', 'criadoPor', 'resolvidoPor']);
    assert.deepEqual(relacoes(autoriaEquipamentoInclude), ['atualizadoPor', 'criadoPor']);
    assert.deepEqual(relacoes(autoriaCategoriaInclude), ['criadoPor']);
    assert.deepEqual(relacoes(autoriaResponsavelInclude), ['criadoPor']);
  });

  it('autorResumo keeps only id and nome and maps a missing author to null', () => {
    assert.deepEqual(autorResumo(autorBruto), autor);
    assert.equal(autorResumo(null), null);
    assert.equal(autorResumo(undefined), null);
  });
});

describe('Guest Mode DTOs never carry authorship', () => {
  it('equipment', () => {
    const dto = publicEquipment(equipamento as Any);
    semAutoria(dto);
    assert.equal(JSON.stringify(dto).includes(autor.nome), false);
  });
  it('loan', () => {
    const dto = publicLoan(emprestimo as Any);
    semAutoria(dto);
    assert.equal(JSON.stringify(dto).includes(autor.nome), false);
  });
  it('occurrence', () => {
    const dto = publicOccurrence(ocorrencia as Any);
    semAutoria(dto);
    assert.equal(JSON.stringify(dto).includes(autor.nome), false);
  });
  it('category', () => {
    assert.deepEqual(publicCategory(categoria), { id: 4, nome: 'Informática' });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Prisma-backed paths with the client delegates swapped (no database needed).

type Modules = {
  prisma: typeof import('../src/lib/prisma.js')['prisma'];
  signToken: typeof import('../src/lib/jwt.js')['signToken'];
  emprestimos: typeof import('../src/services/emprestimo.service.js');
  ocorrencias: typeof import('../src/services/ocorrencia.service.js');
  equipamentos: typeof import('../src/services/equipamento.service.js');
  categorias: typeof import('../src/services/categoria.service.js');
  responsaveis: typeof import('../src/services/responsavel.service.js');
  usuarios: typeof import('../src/services/usuario.service.js');
};
let m: Modules;
let server: Server;
let baseUrl: string;
const restauracoes: Array<() => void> = [];

/** Prisma delegates are lazy proxies that node:test cannot spy on, so the whole delegate is swapped and restored. */
function substituir(alvo: object, chave: string, valor: unknown): void {
  const original = (alvo as Record<string, unknown>)[chave];
  Object.defineProperty(alvo, chave, { value: valor, configurable: true, writable: true, enumerable: true });
  restauracoes.push(() => { Object.defineProperty(alvo, chave, { value: original, configurable: true, writable: true, enumerable: true }); });
}

/** Records every delegate call as "model.method" with its args; `respostas` supplies return values. */
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
            if (metodo === 'updateMany') return { count: 1 };
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
    todas: (op: string) => chamadas.filter((c) => c.op === op).map((c) => c.args),
  };
}

const ACTOR = 42;

before(async () => {
  const [{ prisma }, { signToken }, emprestimos, ocorrencias, equipamentos, categorias, responsaveis, usuarios, rotas] =
    await Promise.all([
      import('../src/lib/prisma.js'),
      import('../src/lib/jwt.js'),
      import('../src/services/emprestimo.service.js'),
      import('../src/services/ocorrencia.service.js'),
      import('../src/services/equipamento.service.js'),
      import('../src/services/categoria.service.js'),
      import('../src/services/responsavel.service.js'),
      import('../src/services/usuario.service.js'),
      Promise.all([
        import('../src/routes/categorias.js'),
        import('../src/routes/equipamentos.js'),
        import('../src/routes/ocorrencias.js'),
        import('../src/routes/emprestimos.js'),
      ]),
    ]);
  m = { prisma, signToken, emprestimos, ocorrencias, equipamentos, categorias, responsaveis, usuarios };
  const app = express();
  app.use('/categorias', rotas[0].categoriasRouter);
  app.use('/equipamentos', rotas[1].equipamentosRouter);
  app.use('/ocorrencias', rotas[2].ocorrenciasRouter);
  app.use('/emprestimos', rotas[3].emprestimosRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  while (restauracoes.length) restauracoes.pop()!();
});

describe('services write the author inside the audited transaction', () => {
  it('loan create sets criadoPorId and stock decrements do not touch the equipment editor', async () => {
    const t = criarTx({
      'equipamento.findMany': () => [{ ...equipamento, quantidadeDisponivel: 10 }],
      'emprestimo.create': () => ({ id: 12, itens: [] }),
    });
    await m.emprestimos.criarEmprestimo({ solicitanteNome: 'X', responsavelId: 2, itens: [{ equipamentoId: 1, quantidade: 1 }] }, ACTOR);
    const create = t.uma('emprestimo.create');
    assert.equal(create.data.criadoPorId, ACTOR);
    assert.deepEqual(Object.keys(create.include).filter((k) => k !== 'itens').sort(), ['atualizadoPor', 'criadoPor', 'devolvidoPor']);
    for (const args of t.todas('equipamento.updateMany')) assert.equal('atualizadoPorId' in args.data, false);
    assert.deepEqual(t.uma('auditLog.create').data, {
      actorId: ACTOR, action: 'CREATE', entity: 'Emprestimo', entityId: '12',
      changedFields: ['solicitanteNome', 'responsavelId', 'dataRetirada', 'observacao', 'itens'],
    });
  });

  it('loan item edit sets atualizadoPorId and atualizadoEm', async () => {
    const t = criarTx({
      'emprestimo.findUnique': () => ({ id: 12, status: 'ABERTO' }),
      'itemEmprestimo.findMany': () => [{ equipamentoId: 1, quantidade: 1 }],
      'equipamento.findMany': () => [{ ...equipamento, quantidadeDisponivel: 10 }],
    });
    const antes = Date.now();
    await m.emprestimos.atualizarItensEmprestimo(12, [{ equipamentoId: 1, quantidade: 2 }], ACTOR);
    const update = t.uma('emprestimo.update');
    assert.equal(update.where.id, 12);
    assert.equal(update.data.atualizadoPorId, ACTOR);
    assert.ok(update.data.atualizadoEm instanceof Date && update.data.atualizadoEm.getTime() >= antes);
    assert.ok(update.include.atualizadoPor);
    for (const args of t.todas('equipamento.update')) assert.equal('atualizadoPorId' in args.data, false);
    assert.equal(t.uma('auditLog.create').data.action, 'UPDATE');
  });

  it('loan return sets devolvidoPorId only (no editor change)', async () => {
    const t = criarTx({
      'emprestimo.findUnique': () => ({ id: 12, status: 'ABERTO', dataRetirada: new Date(Date.now() - 60_000) }),
      'emprestimo.findUniqueOrThrow': () => ({ id: 12, itens: [{ equipamentoId: 1, quantidade: 1 }] }),
    });
    await m.emprestimos.devolverEmprestimo(12, undefined, ACTOR);
    const claim = t.uma('emprestimo.updateMany');
    assert.equal(claim.data.devolvidoPorId, ACTOR);
    assert.equal('atualizadoPorId' in claim.data, false);
    assert.ok(t.uma('emprestimo.findUniqueOrThrow').include.devolvidoPor);
    for (const args of t.todas('equipamento.update')) assert.equal('atualizadoPorId' in args.data, false);
    assert.equal(t.uma('auditLog.create').data.action, 'RETURN');
  });

  it('occurrence create sets criadoPorId on every created row', async () => {
    let id = 0;
    const t = criarTx({ 'ocorrencia.create': () => ({ id: ++id }) });
    await m.ocorrencias.criarOcorrencias({ equipamentoId: 1, tipo: 'OBSERVACAO', problema: 'p', descricao: 'd', numeros: ['A', 'B'] }, ACTOR);
    const creates = t.todas('ocorrencia.create');
    assert.equal(creates.length, 2);
    for (const args of creates) {
      assert.equal(args.data.criadoPorId, ACTOR);
      assert.ok(args.include.criadoPor && args.include.resolvidoPor && args.include.equipamento);
    }
    assert.equal(t.todas('auditLog.create').length, 2);
  });

  it('occurrence edit sets atualizadoPorId and atualizadoEm', async () => {
    const t = criarTx({});
    await m.ocorrencias.atualizarOcorrencia(8, { descricao: 'nova' }, ACTOR);
    const update = t.uma('ocorrencia.update');
    assert.equal(update.data.atualizadoPorId, ACTOR);
    assert.ok(update.data.atualizadoEm instanceof Date);
    assert.equal(t.uma('auditLog.create').data.action, 'UPDATE');
  });

  it('occurrence resolution sets resolvidoPorId and leaves the equipment editor untouched', async () => {
    const t = criarTx({
      'ocorrencia.findUnique': () => ({ id: 8, status: 'ABERTO' }),
      'ocorrencia.findUniqueOrThrow': () => ({ id: 8, tipo: 'QUEBRADO', equipamentoId: 1 }),
    });
    await m.ocorrencias.resolverOcorrencia(8, 'trocado', ACTOR);
    const claim = t.uma('ocorrencia.updateMany');
    assert.equal(claim.data.resolvidoPorId, ACTOR);
    assert.equal('atualizadoPorId' in claim.data, false);
    assert.equal('atualizadoPorId' in t.uma('equipamento.update').data, false);
    assert.equal(t.uma('auditLog.create').data.action, 'RESOLVE');
  });

  it('equipment create sets criadoPorId; explicit equipment edit sets atualizadoPorId', async () => {
    let t = criarTx({ 'equipamento.create': () => ({ id: 1 }) });
    await m.equipamentos.criarEquipamento({ categoriaId: 4, modelo: 'Tablet', quantidadeTotal: 3 }, ACTOR);
    const create = t.uma('equipamento.create');
    assert.equal(create.data.criadoPorId, ACTOR);
    assert.equal('atualizadoPorId' in create.data, false);
    assert.ok(create.include.criadoPor && create.include.atualizadoPor);
    restauracoes.pop()!();

    t = criarTx({
      'equipamento.findUnique': () => ({ ...equipamento, quantidadeQuebrada: 0, quantidadeDisponivel: 2, quantidadeTotal: 3 }),
      'itemEmprestimo.aggregate': () => ({ _sum: { quantidade: 0 } }),
      'ocorrencia.count': () => 0,
    });
    await m.equipamentos.atualizarEquipamento(1, { quantidadeTotal: 5 }, ACTOR);
    assert.equal(t.uma('equipamento.update').data.atualizadoPorId, ACTOR);
    assert.equal(t.uma('auditLog.create').data.action, 'UPDATE');
  });

  it('category and responsible create set criadoPorId', async () => {
    let t = criarTx({ 'categoria.create': () => ({ id: 4 }) });
    await m.categorias.criarCategoria('Informática', ACTOR);
    assert.equal(t.uma('categoria.create').data.criadoPorId, ACTOR);
    assert.equal(t.uma('categoria.create').include, autoriaCategoriaInclude);
    restauracoes.pop()!();
    t = criarTx({ 'responsavel.create': () => ({ id: 2 }) });
    await m.responsaveis.criarResponsavel('Fulana', 'Coordenação', ACTOR);
    assert.equal(t.uma('responsavel.create').data.criadoPorId, ACTOR);
    assert.equal(t.uma('responsavel.create').include, autoriaResponsavelInclude);
  });

  it('user list exposes criadoPor/atualizadoPor as { id, nome } only', async () => {
    let args: Any;
    substituir(m.prisma, 'usuario', {
      findMany: async (a: Any) => {
        args = a;
        return [{ id: 9, nome: 'Editor', login: 'editor@example.invalid', nivelAcesso: 'EDITOR', ativo: true,
          createdAt: new Date(), rfidTokenHash: null, createdBy: autorBruto, updatedBy: null }];
      },
    });
    const [usuario] = await m.usuarios.listarUsuarios();
    assert.equal(args.select.createdBy, autorSelect);
    assert.equal(args.select.updatedBy, autorSelect);
    assert.deepEqual(usuario.criadoPor, autor);
    assert.equal(usuario.atualizadoPor, null);
    assert.equal(JSON.stringify(usuario).includes(autorBruto.login), false);
  });
});

describe('list endpoints: authors for authenticated users, never for guests', () => {
  let chamadas: Record<string, Any[]>;
  const registrar = (nome: string, valor: unknown) => async (args: Any) => {
    (chamadas[nome] ??= []).push(args);
    return valor;
  };

  beforeEach(() => {
    chamadas = {};
    substituir(m.prisma, 'usuario', { findUnique: async () => ({ id: ACTOR, nivelAcesso: 'ADMINISTRADOR', sessionVersion: 0, ativo: true }) });
    substituir(m.prisma, 'categoria', { findMany: registrar('categoria', [categoria]) });
    substituir(m.prisma, 'equipamento', { findMany: registrar('equipamento', [equipamento]) });
    substituir(m.prisma, 'ocorrencia', { findMany: registrar('ocorrencia', [ocorrencia]) });
    substituir(m.prisma, 'emprestimo', { findMany: registrar('emprestimo', [emprestimo]) });
  });

  const get = async (path: string, autenticado: boolean) => {
    const headers: Record<string, string> = autenticado
      ? { authorization: `Bearer ${m.signToken({ sub: ACTOR, nivelAcesso: 'ADMINISTRADOR' })}` }
      : {};
    const resposta = await fetch(`${baseUrl}${path}`, { headers });
    assert.equal(resposta.status, 200);
    return resposta.json();
  };

  for (const [rota, modelo, relacoes] of [
    ['/categorias', 'categoria', ['criadoPor']],
    ['/equipamentos', 'equipamento', ['criadoPor', 'atualizadoPor']],
    ['/ocorrencias', 'ocorrencia', ['criadoPor', 'atualizadoPor', 'resolvidoPor']],
    ['/emprestimos', 'emprestimo', ['criadoPor', 'atualizadoPor', 'devolvidoPor']],
  ] as const) {
    it(`GET ${rota} as guest neither loads nor returns authorship`, async () => {
      const corpo = await get(rota, false);
      const args = chamadas[modelo][0];
      for (const relacao of relacoes) {
        assert.equal(args.include?.[relacao], undefined, `guest query must not load ${relacao}`);
      }
      const lista = Array.isArray(corpo) ? corpo : corpo.items;
      assert.equal(lista.length, 1);
      semAutoria(lista);
      assert.equal(JSON.stringify(corpo).includes(autor.nome), false);
    });

    it(`GET ${rota} as an authenticated user loads authorship through the id+nome projection`, async () => {
      await get(rota, true);
      const args = chamadas[modelo][0];
      for (const relacao of relacoes) assert.equal(args.include[relacao], autorSelect);
    });
  }
});
