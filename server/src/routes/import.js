import { Router } from 'express';
import { apiKeyAuth, authenticate, minRole } from '../middleware/auth.js';
import { importMatch } from '../services/importService.js';

const r = Router();

// Machine-to-machine: game API / tracker pushes finished match JSON
r.post('/match', apiKeyAuth, async (req, res, next) => {
  try { res.status(201).json(await importMatch(req.body, req.connector)); }
  catch (e) { next(e); }
});

// Same pipeline for signed-in staff (paste JSON in the admin panel)
r.post('/match/manual', authenticate, minRole('DATA_ENTRY'), async (req, res, next) => {
  try { res.status(201).json(await importMatch(req.body, null)); }
  catch (e) { next(e); }
});

export default r;
