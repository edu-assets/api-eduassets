import { Router } from 'express';
import { optionalAuth, requireAdmin } from '../middlewares/auth.js';
import { validate, validateBody, requireIntParam } from '../middlewares/validate.js';
import { categoriaCreateSchema, categoriaUpdateSchema } from '../schemas/categoria.schema.js';
import * as categoriasController from '../controllers/categorias.controller.js';

export const categoriasRouter = Router();

categoriasRouter.get('/', optionalAuth, categoriasController.listar);
categoriasRouter.post('/', requireAdmin, validate(categoriaCreateSchema), categoriasController.criar);
categoriasRouter.patch('/:id', requireAdmin, requireIntParam('id'), validateBody(categoriaUpdateSchema), categoriasController.atualizar);
