import { Router } from 'express';
import { optionalAuth, requireAdmin } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { categoriaCreateSchema } from '../schemas/categoria.schema.js';
import * as categoriasController from '../controllers/categorias.controller.js';

export const categoriasRouter = Router();

categoriasRouter.get('/', optionalAuth, categoriasController.listar);
categoriasRouter.post('/', requireAdmin, validate(categoriaCreateSchema), categoriasController.criar);