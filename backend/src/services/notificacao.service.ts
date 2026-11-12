import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { enviar, isPushConfigured, type PushTarget } from '../lib/webPush.js';
import { isAllowedPushEndpoint, type PushPreferencias } from '../schemas/notificacao.schema.js';

export type TipoEventoNotificacao = 'EMPRESTIMO_CRIADO' | 'DEVOLUCAO_REGISTRADA' | 'OCORRENCIA_REGISTRADA';
export type TipoOcorrenciaNotificacao = 'OBSERVACAO' | 'MANUTENCAO' | 'QUEBRADO';

export interface EventoNotificacao {
  tipo: TipoEventoNotificacao;
  autorId: number;
  entidadeId: number;
  itens: Array<{ equipamentoId: number; quantidade: number }>;
  tipoOcorrencia?: TipoOcorrenciaNotificacao;
  /** Loans and returns only: who borrowed the equipment (operator decision to show it). */
  solicitanteNome?: string;
}

/** Wire format read by the service worker (`v: 1`). Only the fields below may ever be sent. */
export interface PushPayload {
  v: 1;
  tipo: TipoEventoNotificacao | 'TESTE';
  titulo: string;
  corpo: string;
  url: string;
  tag: string;
  criadoEm: string;
}

export interface DadosPayload {
  tipo: TipoEventoNotificacao;
  autorNome: string;
  entidadeId: number;
  itens: Array<{ nome: string; quantidade: number }>;
  tipoOcorrencia?: TipoOcorrenciaNotificacao;
  solicitanteNome?: string;
  agora?: Date;
}

const MAX_NOMES_NO_RESUMO = 3;
const MAX_LENGTH_NOME = 40;
const MAX_LENGTH_AUTOR = 60;
const BATCH_SIZE = 10;
const PANEL_URL = '/#panel-controle';

const TITULOS: Record<TipoEventoNotificacao, string> = {
  EMPRESTIMO_CRIADO: 'Novo empréstimo',
  DEVOLUCAO_REGISTRADA: 'Devolução registrada',
  OCORRENCIA_REGISTRADA: 'Nova ocorrência',
};

const ROTULOS_OCORRENCIA: Record<TipoOcorrenciaNotificacao, string> = {
  OBSERVACAO: 'Observação',
  MANUTENCAO: 'Manutenção',
  QUEBRADO: 'Quebrado',
};

function truncar(texto: string, max: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > max ? `${limpo.slice(0, max - 1)}…` : limpo;
}

/** Sums quantities of items sharing the same display name, keeping first-seen order. */
function agruparPorNome(itens: Array<{ nome: string; quantidade: number }>): Array<{ nome: string; quantidade: number }> {
  const porNome = new Map<string, number>();
  for (const item of itens) {
    const nome = truncar(item.nome, MAX_LENGTH_NOME);
    porNome.set(nome, (porNome.get(nome) ?? 0) + item.quantidade);
  }
  return [...porNome].map(([nome, quantidade]) => ({ nome, quantidade }));
}

export function resumirEquipamentos(itens: Array<{ nome: string; quantidade: number }>): string {
  const agrupados = agruparPorNome(itens);
  const visiveis = agrupados.slice(0, MAX_NOMES_NO_RESUMO).map((item) => `${item.nome} ×${item.quantidade}`).join(', ');
  const restantes = agrupados.length - MAX_NOMES_NO_RESUMO;
  return restantes > 0 ? `${visiveis} e mais ${restantes}` : visiveis;
}

/**
 * Pure payload builder. Data minimization: the notification shows on a locked screen, so it carries only the
 * requester's name (loans and returns), an equipment summary, the occurrence type and the registering user's name.
 * Anything else on the input (notes, problem, description, measures taken, patrimony numbers) is ignored by
 * construction because it is never read.
 * Body: "<requester> · <equipment> · por <user>" or, for occurrences, "<equipment> · <type> · por <user>".
 */
export function montarPayload(dados: DadosPayload): PushPayload {
  const partes: string[] = [];
  if (dados.tipo !== 'OCORRENCIA_REGISTRADA' && dados.solicitanteNome) {
    partes.push(truncar(dados.solicitanteNome, MAX_LENGTH_AUTOR));
  }
  partes.push(resumirEquipamentos(dados.itens));
  if (dados.tipo === 'OCORRENCIA_REGISTRADA' && dados.tipoOcorrencia && dados.tipoOcorrencia in ROTULOS_OCORRENCIA) {
    partes.push(ROTULOS_OCORRENCIA[dados.tipoOcorrencia]);
  }
  const autor = truncar(dados.autorNome, MAX_LENGTH_AUTOR);
  if (autor) partes.push(`por ${autor}`);
  return {
    v: 1,
    tipo: dados.tipo,
    titulo: TITULOS[dados.tipo],
    corpo: partes.filter(Boolean).join(' · '),
    url: PANEL_URL,
    tag: `eduassets-${dados.tipo.toLowerCase()}-${dados.entidadeId}`,
    criadoEm: (dados.agora ?? new Date()).toISOString(),
  };
}

export function montarPayloadTeste(agora: Date = new Date()): PushPayload {
  return {
    v: 1,
    tipo: 'TESTE',
    titulo: 'Notificação de teste',
    corpo: 'As notificações estão funcionando neste dispositivo.',
    url: PANEL_URL,
    tag: 'eduassets-teste',
    criadoEm: agora.toISOString(),
  };
}

export interface InscricaoDestino extends PushTarget {
  id: number;
}

/** Data access used by the sender; replaceable in tests so no database is needed. */
export interface NotificacaoRepository {
  nomeUsuario(usuarioId: number): Promise<string | null>;
  nomesEquipamentos(ids: number[]): Promise<Map<number, string>>;
  inscricoesDestino(evento: TipoEventoNotificacao, autorId: number): Promise<InscricaoDestino[]>;
  inscricoesDoUsuario(usuarioId: number): Promise<InscricaoDestino[]>;
  apagarInscricao(id: number): Promise<void>;
  marcarSucesso(id: number, em: Date): Promise<void>;
}

const CAMPO_PREFERENCIA = {
  EMPRESTIMO_CRIADO: 'notificarEmprestimo',
  DEVOLUCAO_REGISTRADA: 'notificarDevolucao',
  OCORRENCIA_REGISTRADA: 'notificarOcorrencia',
} as const;

const SELECAO_DESTINO = { id: true, endpoint: true, p256dh: true, auth: true } as const;

const prismaRepository: NotificacaoRepository = {
  async nomeUsuario(usuarioId) {
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } });
    return usuario?.nome ?? null;
  },
  async nomesEquipamentos(ids) {
    const equipamentos = await prisma.equipamento.findMany({
      where: { id: { in: ids } },
      select: { id: true, modelo: true, categoria: { select: { nome: true } } },
    });
    // "Categoria Modelo" (e.g. "Notebook Dell Latitude"); montarPayload truncates long names.
    return new Map(equipamentos.map((equipamento) => [
      equipamento.id,
      [equipamento.categoria.nome, equipamento.modelo].map((parte) => parte.trim()).filter(Boolean).join(' '),
    ]));
  },
  inscricoesDestino(evento, autorId) {
    // Recipients are decided at send time: demotion or deactivation stops delivery immediately.
    return prisma.pushSubscription.findMany({
      where: {
        usuarioId: { not: autorId },
        usuario: { ativo: true, nivelAcesso: 'ADMINISTRADOR' },
        [CAMPO_PREFERENCIA[evento]]: true,
      },
      select: SELECAO_DESTINO,
    });
  },
  inscricoesDoUsuario(usuarioId) {
    return prisma.pushSubscription.findMany({ where: { usuarioId }, select: SELECAO_DESTINO });
  },
  async apagarInscricao(id) {
    await prisma.pushSubscription.deleteMany({ where: { id } });
  },
  async marcarSucesso(id, em) {
    await prisma.pushSubscription.updateMany({ where: { id }, data: { lastSuccessAt: em } });
  },
};

let repository: NotificacaoRepository = prismaRepository;

/** Test hook: replaces data access (pass null to restore). */
export function setNotificacaoRepositoryForTests(replacement: NotificacaoRepository | null): void {
  repository = replacement ?? prismaRepository;
}

function statusDoErro(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

async function enviarUma(inscricao: InscricaoDestino, payload: string): Promise<void> {
  try {
    // Defense in depth against rows that predate or bypass request validation.
    if (!isAllowedPushEndpoint(inscricao.endpoint)) {
      await repository.apagarInscricao(inscricao.id);
      logger.warn('Inscrição push com endpoint não permitido removida.', { inscricaoId: inscricao.id });
      return;
    }
    await enviar(inscricao, payload);
    await repository.marcarSucesso(inscricao.id, new Date());
  } catch (error) {
    const status = statusDoErro(error);
    try {
      if (status === 404 || status === 410) {
        await repository.apagarInscricao(inscricao.id);
        return;
      }
    } catch {
      // Falls through to the generic warning below.
    }
    // Never log the endpoint, keys, payload or the raw error message (library errors can embed them).
    logger.warn('Falha ao enviar notificação push.', { inscricaoId: inscricao.id, status: status ?? null });
  }
}

/** Sends in small parallel batches; never throws. */
export async function enviarParaInscricoes(inscricoes: InscricaoDestino[], payload: PushPayload): Promise<void> {
  const corpo = JSON.stringify(payload);
  for (let inicio = 0; inicio < inscricoes.length; inicio += BATCH_SIZE) {
    await Promise.all(inscricoes.slice(inicio, inicio + BATCH_SIZE).map((inscricao) => enviarUma(inscricao, corpo)));
  }
}

export async function notificarEvento(evento: EventoNotificacao): Promise<void> {
  if (!isPushConfigured()) return;
  const [autorNome, nomes] = await Promise.all([
    repository.nomeUsuario(evento.autorId),
    repository.nomesEquipamentos([...new Set(evento.itens.map((item) => item.equipamentoId))]),
  ]);
  const destinos = await repository.inscricoesDestino(evento.tipo, evento.autorId);
  if (!destinos.length) return;
  const payload = montarPayload({
    tipo: evento.tipo,
    autorNome: autorNome ?? '',
    entidadeId: evento.entidadeId,
    tipoOcorrencia: evento.tipoOcorrencia,
    solicitanteNome: evento.solicitanteNome,
    itens: evento.itens.map((item) => ({ nome: nomes.get(item.equipamentoId) ?? 'Equipamento', quantidade: item.quantidade })),
  });
  await enviarParaInscricoes(destinos, payload);
}

/** Post-commit hook for controllers: never awaited by the response and never able to fail the request. */
export function dispararNotificacao(evento: EventoNotificacao): void {
  try {
    notificarEvento(evento).catch(registrarFalhaDeDisparo);
  } catch (error) {
    registrarFalhaDeDisparo(error);
  }
}

function registrarFalhaDeDisparo(error: unknown): void {
  logger.error('Falha ao processar notificação push.', { error: error instanceof Error ? error.name : 'erro desconhecido' });
}

/** Test notification: only the caller's own subscriptions, regardless of the per-type preferences. */
export async function enviarTeste(usuarioId: number): Promise<void> {
  if (!isPushConfigured()) return;
  const destinos = await repository.inscricoesDoUsuario(usuarioId);
  if (!destinos.length) return;
  await enviarParaInscricoes(destinos, montarPayloadTeste());
}

export function dispararTeste(usuarioId: number): void {
  try {
    enviarTeste(usuarioId).catch(registrarFalhaDeDisparo);
  } catch (error) {
    registrarFalhaDeDisparo(error);
  }
}

export async function salvarInscricao(
  usuarioId: number,
  inscricao: { endpoint: string; keys: { p256dh: string; auth: string } },
  preferencias: PushPreferencias
): Promise<PushPreferencias> {
  const campos = {
    p256dh: inscricao.keys.p256dh,
    auth: inscricao.keys.auth,
    notificarEmprestimo: preferencias.emprestimo,
    notificarDevolucao: preferencias.devolucao,
    notificarOcorrencia: preferencias.ocorrencia,
  };
  // An endpoint that belonged to another user (shared browser) is handed over to the current user.
  const salva = await prisma.pushSubscription.upsert({
    where: { endpoint: inscricao.endpoint },
    create: { usuarioId, endpoint: inscricao.endpoint, ...campos },
    update: { usuarioId, ...campos },
    select: { notificarEmprestimo: true, notificarDevolucao: true, notificarOcorrencia: true },
  });
  return { emprestimo: salva.notificarEmprestimo, devolucao: salva.notificarDevolucao, ocorrencia: salva.notificarOcorrencia };
}

/** Only removes a subscription owned by the caller. */
export async function removerInscricao(usuarioId: number, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint, usuarioId } });
}
