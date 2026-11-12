import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedPushEndpoint,
  pushInscricaoSchema,
  pushRemocaoSchema,
} from '../src/schemas/notificacao.schema.js';
import {
  montarPayload,
  montarPayloadTeste,
  notificarEvento,
  enviarTeste,
  dispararNotificacao,
  setNotificacaoRepositoryForTests,
  type InscricaoDestino,
  type NotificacaoRepository,
  type TipoEventoNotificacao,
} from '../src/services/notificacao.service.js';
import {
  getPushConfig,
  setPushConfigForTests,
  setPushSenderForTests,
  type PushTarget,
} from '../src/lib/webPush.js';
import { sessionCapabilities } from '../src/controllers/auth.controller.js';

const P256DH = 'B'.repeat(87);
const AUTH = 'a'.repeat(22);
const FCM = 'https://fcm.googleapis.com/fcm/send/abc123:APA91bExample-token_x';

const validBody = (endpoint = FCM) => ({
  inscricao: { endpoint, keys: { p256dh: P256DH, auth: AUTH } },
  preferencias: { emprestimo: true, devolucao: false, ocorrencia: true },
});

describe('push endpoint allowlist (SSRF protection)', () => {
  it('accepts FCM, Apple, Mozilla and Windows push services', () => {
    for (const endpoint of [
      FCM,
      'https://fcm.googleapis.com/wp/xyz',
      'https://web.push.apple.com/QGv0abc',
      'https://api.push.apple.com/3/device/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://a.b.notify.windows.com/w',
    ]) {
      assert.equal(isAllowedPushEndpoint(endpoint), true, endpoint);
      assert.equal(pushInscricaoSchema.safeParse(validBody(endpoint)).success, true, endpoint);
    }
  });

  it('rejects http, other hosts, IPs, localhost, lookalikes and malformed values', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'ftp://fcm.googleapis.com/x',
      'https://example.com/push',
      'https://evil.com/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.com/x',
      'https://evilfcm.googleapis.com/x',
      'https://fcm.googleapis.com.@evil.com/x',
      'https://evil.com\\@fcm.googleapis.com/x',
      'https://evil.com#@fcm.googleapis.com/x',
      'https://push.apple.com/x',
      'https://evilpush.apple.com/x',
      'https://x.push.apple.com.evil.com/x',
      'https://fcm.googleapis.com./x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://10.0.0.5/x',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'https://localhost.push.apple.com.evil/x',
      'https://2130706433/x',
      '//fcm.googleapis.com/x',
      'fcm.googleapis.com/x',
      '',
      'not a url',
      'https://fcm.googleapis.com/ x',
    ]) {
      assert.equal(isAllowedPushEndpoint(endpoint), false, endpoint);
      assert.equal(pushInscricaoSchema.safeParse(validBody(endpoint)).success, false, endpoint);
    }
  });

  it('rejects credentials, explicit ports (even the default one) and fragments', () => {
    for (const endpoint of [
      'https://user:pass@fcm.googleapis.com/x',
      'https://user@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:443/x',
      'https://fcm.googleapis.com:8443/x',
      'https://web.push.apple.com:444/x',
      'https://fcm.googleapis.com/x#frag',
    ]) {
      assert.equal(isAllowedPushEndpoint(endpoint), false, endpoint);
    }
  });

  it('rejects endpoints longer than 1024 characters', () => {
    const longEndpoint = `https://fcm.googleapis.com/fcm/send/${'a'.repeat(1100)}`;
    assert.equal(isAllowedPushEndpoint(longEndpoint), false);
    const atLimit = `https://fcm.googleapis.com/${'a'.repeat(1024 - 'https://fcm.googleapis.com/'.length)}`;
    assert.equal(atLimit.length, 1024);
    assert.equal(isAllowedPushEndpoint(atLimit), true);
    assert.equal(isAllowedPushEndpoint(`${atLimit}a`), false);
  });

  it('validates key lengths, alphabet and the three required preference booleans', () => {
    const base = validBody();
    const withKeys = (p256dh: string, auth: string) => ({ ...base, inscricao: { ...base.inscricao, keys: { p256dh, auth } } });
    assert.equal(pushInscricaoSchema.safeParse(withKeys('B'.repeat(80), 'a'.repeat(16))).success, true);
    assert.equal(pushInscricaoSchema.safeParse(withKeys('B'.repeat(100), 'a'.repeat(32))).success, true);
    assert.equal(pushInscricaoSchema.safeParse(withKeys('B'.repeat(79), AUTH)).success, false);
    assert.equal(pushInscricaoSchema.safeParse(withKeys('B'.repeat(101), AUTH)).success, false);
    assert.equal(pushInscricaoSchema.safeParse(withKeys(P256DH, 'a'.repeat(15))).success, false);
    assert.equal(pushInscricaoSchema.safeParse(withKeys(P256DH, 'a'.repeat(33))).success, false);
    assert.equal(pushInscricaoSchema.safeParse(withKeys(`${'B'.repeat(86)}+`, AUTH)).success, false);
    assert.equal(pushInscricaoSchema.safeParse(withKeys(P256DH, `${'a'.repeat(21)}=`)).success, false);

    assert.equal(pushInscricaoSchema.safeParse({ ...base, preferencias: { emprestimo: true, devolucao: true } }).success, false);
    assert.equal(pushInscricaoSchema.safeParse({ ...base, preferencias: { emprestimo: 'sim', devolucao: true, ocorrencia: true } }).success, false);
    assert.equal(pushInscricaoSchema.safeParse({ inscricao: base.inscricao }).success, false);
  });

  it('reports i18n keys as validation messages and keeps removal lenient but bounded', () => {
    const result = pushInscricaoSchema.safeParse(validBody('http://example.com/x'));
    assert.equal(result.success, false);
    assert.ok(!result.success && result.error.issues.some((issue) => issue.message === 'backend.notificacoes.endpoint_invalido'));
    assert.equal(pushRemocaoSchema.safeParse({ endpoint: FCM }).success, true);
    assert.equal(pushRemocaoSchema.safeParse({ endpoint: '' }).success, false);
    assert.equal(pushRemocaoSchema.safeParse({ endpoint: 'a'.repeat(1025) }).success, false);
    assert.equal(pushRemocaoSchema.safeParse({}).success, false);
  });
});

describe('montarPayload', () => {
  const agora = new Date('2026-11-13T12:00:00Z');

  it('builds title and body per event type', () => {
    const emprestimo = montarPayload({
      tipo: 'EMPRESTIMO_CRIADO', autorNome: 'Ana Souza', entidadeId: 7, agora, solicitanteNome: 'João Silva',
      itens: [{ nome: 'Notebook', quantidade: 2 }, { nome: 'Projetor', quantidade: 1 }],
    });
    assert.deepEqual(emprestimo, {
      v: 1,
      tipo: 'EMPRESTIMO_CRIADO',
      titulo: 'Novo empréstimo',
      corpo: 'João Silva · Notebook ×2, Projetor ×1 · por Ana Souza',
      url: '/#panel-controle',
      tag: 'eduassets-emprestimo_criado-7',
      criadoEm: '2026-11-13T12:00:00.000Z',
    });

    const devolucao = montarPayload({ tipo: 'DEVOLUCAO_REGISTRADA', autorNome: 'Ana Souza', solicitanteNome: 'João Silva', entidadeId: 8, itens: [{ nome: 'Notebook', quantidade: 2 }] });
    assert.equal(devolucao.titulo, 'Devolução registrada');
    assert.equal(devolucao.corpo, 'João Silva · Notebook ×2 · por Ana Souza');

    const ocorrencia = montarPayload({
      tipo: 'OCORRENCIA_REGISTRADA', autorNome: 'Ana Souza', entidadeId: 9, tipoOcorrencia: 'QUEBRADO',
      itens: [{ nome: 'Notebook', quantidade: 2 }],
    });
    assert.equal(ocorrencia.titulo, 'Nova ocorrência');
    assert.equal(ocorrencia.corpo, 'Notebook ×2 · Quebrado · por Ana Souza');
  });

  it('limits the summary to 3 names plus "e mais N" and merges repeated names', () => {
    const payload = montarPayload({
      tipo: 'EMPRESTIMO_CRIADO', autorNome: 'Ana', entidadeId: 1,
      itens: [
        { nome: 'A', quantidade: 1 }, { nome: 'B', quantidade: 2 }, { nome: 'C', quantidade: 3 },
        { nome: 'D', quantidade: 4 }, { nome: 'E', quantidade: 5 }, { nome: 'A', quantidade: 1 },
      ],
    });
    assert.equal(payload.corpo, 'A ×2, B ×2, C ×3 e mais 2 · por Ana');
  });

  it('never leaks notes, free text, patrimony numbers or (for occurrences) a requester name even when present on the input', () => {
    const hostile = {
      tipo: 'OCORRENCIA_REGISTRADA',
      autorNome: 'Ana Souza',
      entidadeId: 42,
      tipoOcorrencia: 'QUEBRADO',
      itens: [{ nome: 'Notebook', quantidade: 2, numero: 'PAT-98765', numeros: ['PAT-98765', 'PAT-11111'] }],
      solicitanteNome: 'Joao Solicitante',
      observacao: 'observacao secreta',
      problema: 'tela trincada',
      descricao: 'caiu da mesa na sala 3',
      medidasTomadas: 'enviado ao suporte',
      numero: 'PAT-98765',
      numeros: ['PAT-98765'],
    } as unknown as Parameters<typeof montarPayload>[0];
    const serialized = JSON.stringify(montarPayload(hostile));
    for (const secret of ['Joao Solicitante', 'observacao secreta', 'tela trincada', 'caiu da mesa', 'enviado ao suporte', 'PAT-98765', 'PAT-11111']) {
      assert.ok(!serialized.includes(secret), `payload leaked ${secret}`);
    }
    assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), ['corpo', 'criadoEm', 'tag', 'tipo', 'titulo', 'url', 'v']);
  });

  it('shows the requester on loans but still drops notes and free text', () => {
    const emprestimo = {
      tipo: 'EMPRESTIMO_CRIADO',
      autorNome: 'Ana Souza',
      solicitanteNome: 'João Silva',
      entidadeId: 5,
      itens: [{ nome: 'Notebook', quantidade: 1 }],
      observacao: 'observacao secreta',
    } as unknown as Parameters<typeof montarPayload>[0];
    const payload = montarPayload(emprestimo);
    assert.equal(payload.corpo, 'João Silva · Notebook ×1 · por Ana Souza');
    assert.ok(!JSON.stringify(payload).includes('observacao secreta'));
  });

  it('truncates very long names to keep the payload small', () => {
    const payload = montarPayload({ tipo: 'EMPRESTIMO_CRIADO', autorNome: 'x'.repeat(500), entidadeId: 1, itens: [{ nome: 'y'.repeat(500), quantidade: 1 }] });
    assert.ok(payload.corpo.length < 150);
  });

  it('builds a test payload', () => {
    const teste = montarPayloadTeste(new Date('2026-11-13T12:00:00Z'));
    assert.equal(teste.tipo, 'TESTE');
    assert.equal(teste.v, 1);
  });
});

describe('notificarEvento delivery', () => {
  interface Banco {
    inscricoes: Array<InscricaoDestino & { usuarioId: number; ativo: boolean; admin: boolean; prefs: Record<TipoEventoNotificacao, boolean> }>;
    apagadas: number[];
    sucessos: number[];
    consultas: Array<{ evento: TipoEventoNotificacao; autorId: number }>;
  }
  let banco: Banco;
  let enviados: Array<{ target: PushTarget; payload: string }>;
  let comportamento: (target: PushTarget) => Promise<void>;

  const todas = { EMPRESTIMO_CRIADO: true, DEVOLUCAO_REGISTRADA: true, OCORRENCIA_REGISTRADA: true };
  const inscricao = (id: number, usuarioId: number, extra: Partial<Banco['inscricoes'][number]> = {}) => ({
    id, usuarioId, endpoint: `https://fcm.googleapis.com/fcm/send/sub-${id}`, p256dh: P256DH, auth: AUTH,
    ativo: true, admin: true, prefs: { ...todas }, ...extra,
  });

  const repo: NotificacaoRepository = {
    nomeUsuario: async () => 'Ana Souza',
    nomesEquipamentos: async (ids) => new Map(ids.map((id) => [id, id === 1 ? 'Notebook' : 'Projetor'])),
    inscricoesDestino: async (evento, autorId) => {
      banco.consultas.push({ evento, autorId });
      // Mirrors the Prisma filter so the test exercises the documented recipient rules.
      return banco.inscricoes.filter((s) => s.ativo && s.admin && s.usuarioId !== autorId && s.prefs[evento]);
    },
    inscricoesDoUsuario: async (usuarioId) => banco.inscricoes.filter((s) => s.usuarioId === usuarioId),
    apagarInscricao: async (id) => { banco.apagadas.push(id); },
    marcarSucesso: async (id) => { banco.sucessos.push(id); },
  };

  const evento = { tipo: 'EMPRESTIMO_CRIADO' as const, autorId: 1, entidadeId: 5, itens: [{ equipamentoId: 1, quantidade: 2 }] };

  beforeEach(() => {
    banco = { inscricoes: [], apagadas: [], sucessos: [], consultas: [] };
    enviados = [];
    comportamento = async () => undefined;
    setNotificacaoRepositoryForTests(repo);
    setPushConfigForTests({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.co' });
    setPushSenderForTests(async (target, payload) => {
      enviados.push({ target, payload });
      await comportamento(target);
    });
  });

  afterEach(() => {
    setNotificacaoRepositoryForTests(null);
    setPushConfigForTests(undefined);
    setPushSenderForTests(null);
  });

  it('does nothing and never calls the sender when push is not configured', async () => {
    setPushConfigForTests(null);
    banco.inscricoes.push(inscricao(1, 2));
    await notificarEvento(evento);
    await enviarTeste(2);
    assert.equal(enviados.length, 0);
    assert.equal(banco.consultas.length, 0);
  });

  it('delivers to active administrators other than the author, honoring the per-type preference', async () => {
    banco.inscricoes.push(
      inscricao(1, 1),                                                         // author
      inscricao(2, 2),                                                         // eligible
      inscricao(3, 3, { ativo: false }),                                       // deactivated
      inscricao(4, 4, { admin: false }),                                       // demoted
      inscricao(5, 5, { prefs: { ...todas, EMPRESTIMO_CRIADO: false } }),      // type disabled
      inscricao(6, 2)                                                          // second device of the eligible admin
    );
    await notificarEvento(evento);
    assert.deepEqual(enviados.map((e) => e.target.endpoint).sort(), [
      'https://fcm.googleapis.com/fcm/send/sub-2',
      'https://fcm.googleapis.com/fcm/send/sub-6',
    ]);
    assert.deepEqual(banco.sucessos.sort(), [2, 6]);
    assert.deepEqual(banco.consultas, [{ evento: 'EMPRESTIMO_CRIADO', autorId: 1 }]);
    const payload = JSON.parse(enviados[0].payload);
    assert.equal(payload.titulo, 'Novo empréstimo');
    assert.equal(payload.corpo, 'Notebook ×2 · por Ana Souza');
  });

  it('removes the subscription on 404/410 and keeps delivering to the others', async () => {
    banco.inscricoes.push(inscricao(2, 2), inscricao(3, 3), inscricao(4, 4));
    comportamento = async (target) => {
      if (target.endpoint.endsWith('sub-2')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      if (target.endpoint.endsWith('sub-3')) throw Object.assign(new Error('Not found'), { statusCode: 404 });
    };
    await notificarEvento(evento);
    assert.deepEqual(banco.apagadas.sort(), [2, 3]);
    assert.deepEqual(banco.sucessos, [4]);
  });

  it('does not throw nor delete on generic errors, and never logs endpoint or payload', async () => {
    banco.inscricoes.push(inscricao(2, 2), inscricao(3, 3));
    comportamento = async (target) => {
      if (target.endpoint.endsWith('sub-2')) throw Object.assign(new Error('boom https://fcm.googleapis.com/fcm/send/sub-2'), { statusCode: 500 });
      if (target.endpoint.endsWith('sub-3')) throw new Error('network down');
    };
    const logged: string[] = [];
    const originals = new Map<string, typeof process.stdout.write>();
    originals.set('stdout', process.stdout.write.bind(process.stdout));
    process.stdout.write = ((chunk: unknown) => { logged.push(String(chunk)); return true; }) as typeof process.stdout.write;
    try {
      await assert.doesNotReject(notificarEvento(evento));
    } finally {
      process.stdout.write = originals.get('stdout')!;
    }
    assert.deepEqual(banco.apagadas, []);
    assert.deepEqual(banco.sucessos, []);
    await new Promise((resolve) => setImmediate(resolve));
    const output = logged.join('');
    assert.ok(output.includes('Falha ao enviar notificação push'), 'expected a warning to be logged');
    assert.ok(!output.includes('fcm.googleapis.com'), 'endpoint must not be logged');
    assert.ok(!output.includes(P256DH) && !output.includes(AUTH), 'keys must not be logged');
    assert.ok(!output.includes('Ana Souza'), 'payload must not be logged');
  });

  it('removes rows whose stored endpoint is no longer allowed without calling the push service', async () => {
    banco.inscricoes.push(inscricao(2, 2, { endpoint: 'https://internal.example.com/hook' }));
    await notificarEvento(evento);
    assert.equal(enviados.length, 0);
    assert.deepEqual(banco.apagadas, [2]);
  });

  it('sends in batches without losing subscriptions', async () => {
    for (let id = 2; id < 40; id += 1) banco.inscricoes.push(inscricao(id, id));
    await notificarEvento(evento);
    assert.equal(enviados.length, 38);
  });

  it('test notification reaches only the caller own subscriptions, regardless of preferences', async () => {
    banco.inscricoes.push(
      inscricao(1, 1, { prefs: { EMPRESTIMO_CRIADO: false, DEVOLUCAO_REGISTRADA: false, OCORRENCIA_REGISTRADA: false } }),
      inscricao(2, 1),
      inscricao(3, 2)
    );
    await enviarTeste(1);
    assert.deepEqual(enviados.map((e) => e.target.endpoint).sort(), [
      'https://fcm.googleapis.com/fcm/send/sub-1',
      'https://fcm.googleapis.com/fcm/send/sub-2',
    ]);
    assert.equal(JSON.parse(enviados[0].payload).tipo, 'TESTE');
  });

  it('dispararNotificacao never throws, even when data access fails', async () => {
    setNotificacaoRepositoryForTests({ ...repo, nomeUsuario: async () => { throw new Error('db down'); } });
    assert.doesNotThrow(() => dispararNotificacao(evento));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(enviados.length, 0);
  });

  it('every payload sent for an event only carries the whitelisted fields', async () => {
    banco.inscricoes.push(inscricao(2, 2));
    await notificarEvento({ tipo: 'OCORRENCIA_REGISTRADA', autorId: 1, entidadeId: 9, itens: [{ equipamentoId: 1, quantidade: 3 }], tipoOcorrencia: 'MANUTENCAO' });
    const payload = JSON.parse(enviados[0].payload);
    assert.deepEqual(Object.keys(payload).sort(), ['corpo', 'criadoEm', 'tag', 'tipo', 'titulo', 'url', 'v']);
    assert.equal(payload.corpo, 'Notebook ×3 · Manutenção · por Ana Souza');
  });
});

describe('VAPID configuration', () => {
  // 65-byte public key and 32-byte private key, base64url (shape of `web-push generate-vapid-keys`).
  const publicKey = Buffer.alloc(65, 4).toString('base64url');
  const privateKey = Buffer.alloc(32, 7).toString('base64url');

  it('is disabled when nothing, a partial set or malformed values are provided', () => {
    assert.equal(getPushConfig({}), null);
    assert.equal(getPushConfig({ VAPID_PUBLIC_KEY: publicKey }), null);
    assert.equal(getPushConfig({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey }), null);
    assert.equal(getPushConfig({ VAPID_PUBLIC_KEY: 'short', VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: 'mailto:a@b.co' }), null);
    assert.equal(getPushConfig({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: 'short', VAPID_SUBJECT: 'mailto:a@b.co' }), null);
    assert.equal(getPushConfig({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: 'suporte' }), null);
  });

  it('accepts a well-formed mailto: or https: subject', () => {
    assert.deepEqual(
      getPushConfig({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: 'mailto:suporte@eduassets.tech' }),
      { publicKey, privateKey, subject: 'mailto:suporte@eduassets.tech' }
    );
    assert.notEqual(getPushConfig({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: 'https://eduassets.tech' }), null);
  });

});

describe('session capabilities', () => {
  function capabilities() {
    let body: unknown;
    const res = { setHeader() {}, json(value: unknown) { body = value; } };
    sessionCapabilities({} as never, res as never);
    return body as Record<string, unknown>;
  }

  afterEach(() => setPushConfigForTests(undefined));

  it('reports pushNotifications false without VAPID and true with it', () => {
    setPushConfigForTests(null);
    assert.equal(capabilities().pushNotifications, false);
    assert.equal(capabilities().cookieSession, true);
    setPushConfigForTests({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.co' });
    assert.equal(capabilities().pushNotifications, true);
  });
});
