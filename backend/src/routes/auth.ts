import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { loginSchema, alterarSenhaSchema, rfidScanSchema } from '../schemas/auth.schema.js';
import {
  loginRateLimiter,
  loginIpRateLimiter,
  rfidLoginRateLimiter,
  changePasswordRateLimiter,
} from '../middlewares/rateLimit.js';
import * as authController from '../controllers/auth.controller.js';

export const authRouter = Router();

authRouter.post('/login', loginIpRateLimiter, loginRateLimiter, validate(loginSchema), authController.login);
authRouter.get('/me', requireAuth, authController.me);
authRouter.post('/logout', requireAuth, authController.logout);
authRouter.patch(
  '/senha',
  requireAuth,
  changePasswordRateLimiter,
  validate(alterarSenhaSchema),
  authController.alterarSenha
);
authRouter.post('/rfid', rfidLoginRateLimiter, validate(rfidScanSchema), authController.loginRfid);
