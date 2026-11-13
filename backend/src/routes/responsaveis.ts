import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middlewares/auth.js';
import { validateBody, requireIntParam } from '../middlewares/validate.js';
import { responsavelCreateSchema, responsavelUpdateSchema } from '../schemas/index.js';
import * as responsaveisController from '../controllers/responsaveis.controller.js';

export const responsaveisRouter = Router();

responsaveisRouter.get('/', requireAuth, responsaveisController.listar);
responsaveisRouter.post(
  '/',
  requireAdmin,
  validateBody(responsavelCreateSchema),
  responsaveisController.criar
);
responsaveisRouter.patch(
  '/:id',
  requireAdmin,
  requireIntParam('id'),
  validateBody(responsavelUpdateSchema),
  responsaveisController.atualizar
);
