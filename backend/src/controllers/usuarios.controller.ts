import type { Request, Response } from 'express';
import * as usuariosService from '../services/usuario.service.js';

export async function listar(req: Request, res: Response): Promise<void> {
  const usuarios = await usuariosService.listarUsuarios();
  res.json(usuarios);
}

export async function criar(req: Request, res: Response): Promise<void> {
  const criado = await usuariosService.criarUsuario(req.body, req.user!.sub);
  res.status(201).json(criado);
}

export async function atualizar(req: Request, res: Response): Promise<void> {
  const atualizado = await usuariosService.atualizarUsuario(Number(req.params.id), req.body, req.user!.sub);
  res.json(atualizado);
}

export async function resetarSenha(req: Request, res: Response): Promise<void> {
  await usuariosService.resetarSenhaUsuario(Number(req.params.id), req.body.senha, req.user!.sub);
  res.status(204).send();
}

export async function provisionarRfid(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const resultado = await usuariosService.provisionarCartaoRfid(id, req.user!.sub);
  res.status(201).json(resultado);
}

export async function revogarRfid(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  await usuariosService.revogarCartaoRfid(id, req.user!.sub);
  res.status(204).send();
}
