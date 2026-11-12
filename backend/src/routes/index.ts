import { Router } from 'express';
import { authRouter } from './auth.js';
import { categoriasRouter } from './categorias.js';
import { equipamentosRouter } from './equipamentos.js';
import { responsaveisRouter } from './responsaveis.js';
import { usuariosRouter } from './usuarios.js';
import { emprestimosRouter } from './emprestimos.js';
import { ocorrenciasRouter } from './ocorrencias.js';
import { notificacoesRouter } from './notificacoes.js';

export const routes = Router();

routes.use('/auth', authRouter);
routes.use('/categorias', categoriasRouter);
routes.use('/equipamentos', equipamentosRouter);
routes.use('/responsaveis', responsaveisRouter);
routes.use('/usuarios', usuariosRouter);
routes.use('/emprestimos', emprestimosRouter);
routes.use('/ocorrencias', ocorrenciasRouter);
routes.use('/notificacoes', notificacoesRouter);
