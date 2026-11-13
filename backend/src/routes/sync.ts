import { Router } from 'express';
import { requireAuth, marcarPassivo } from '../middlewares/auth.js';
import { syncRateLimiter } from '../middlewares/rateLimit.js';
import * as syncController from '../controllers/sync.controller.js';

export const syncRouter = Router();

// Polling endpoint: always passive (never renews the administrator idle timeout) and rate limited on its own
// quota (mounted before the global limiter in app.ts).
syncRouter.get('/estado', syncRateLimiter, marcarPassivo, requireAuth, syncController.estado);
