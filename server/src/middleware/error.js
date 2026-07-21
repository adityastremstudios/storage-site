import { ZodError } from 'zod';

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
    });
  }
  if (err && err.code === 'P2002') {
    return res.status(409).json({ error: `Already exists (${(err.meta?.target || []).toString()})` });
  }
  if (err && err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.publicMessage || 'Something went wrong' });
}

export function httpError(status, publicMessage) {
  const e = new Error(publicMessage);
  e.status = status;
  e.publicMessage = publicMessage;
  return e;
}
