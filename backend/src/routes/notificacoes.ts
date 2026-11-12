import { Router } from 'express';
import { requireAdmin } from '../middlewares/auth.js';
import { validateBody } from '../middlewares/validate.js';
import { pushNotificationsRateLimiter } from '../middlewares/rateLimit.js';
import { pushInscricaoSchema, pushRemocaoSchema } from '../schemas/notificacao.schema.js';
import * as notificacoesController from '../controllers/notificacoes.controller.js';

export const notificacoesRouter = Router();

notificacoesRouter.get('/push/config', requireAdmin, notificacoesController.config);
notificacoesRouter.put(
  '/push/inscricao',
  requireAdmin,
  pushNotificationsRateLimiter,
  validateBody(pushInscricaoSchema),
  notificacoesController.salvarInscricao
);
notificacoesRouter.delete(
  '/push/inscricao',
  requireAdmin,
  pushNotificationsRateLimiter,
  validateBody(pushRemocaoSchema),
  notificacoesController.removerInscricao
);
notificacoesRouter.post(
  '/push/teste',
  requireAdmin,
  pushNotificationsRateLimiter,
  notificacoesController.enviarTeste
);
