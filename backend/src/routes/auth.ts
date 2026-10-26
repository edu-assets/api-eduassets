import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { requireTrustedOriginForCookieMode } from '../middlewares/csrf.js';
import { validate } from '../middlewares/validate.js';
import { loginSchema, alterarSenhaSchema, rfidScanSchema, rfidSessionSchema } from '../schemas/auth.schema.js';
import {
  loginRateLimiter,
  loginIpRateLimiter,
  rfidLoginRateLimiter,
  changePasswordRateLimiter,
} from '../middlewares/rateLimit.js';
import * as authController from '../controllers/auth.controller.js';

export const authRouter = Router();

authRouter.get('/session-capabilities', authController.sessionCapabilities);
authRouter.post('/login', loginIpRateLimiter, loginRateLimiter, requireTrustedOriginForCookieMode, validate(loginSchema), authController.login);
authRouter.get('/me', requireAuth, authController.me);
authRouter.post('/logout', requireAuth, authController.logout);
authRouter.patch(
  '/senha',
  requireAuth,
  changePasswordRateLimiter,
  validate(alterarSenhaSchema),
  authController.alterarSenha
);
if (process.env.RFID_BRIDGE_ENABLED === 'true') {
  authRouter.post('/rfid', rfidLoginRateLimiter, validate(rfidScanSchema), authController.loginRfid);
  authRouter.post('/rfid/session', rfidLoginRateLimiter, requireTrustedOriginForCookieMode, validate(rfidSessionSchema), authController.loginRfidSession);
}
