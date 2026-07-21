import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { authenticate, minRole } from '../middleware/auth.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsDir = path.resolve(dirname, '../../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const r = Router();
r.use(authenticate);

r.post('/', minRole('DATA_ENTRY'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Attach an image in the "file" field' });
    const url = `/uploads/${req.file.filename}`;
    const media = await prisma.media.create({
      data: { url, key: req.file.filename, type: req.file.mimetype, size: req.file.size, uploadedById: req.user.id },
    });
    res.status(201).json(media);
  } catch (e) { next(e); }
});

r.get('/', async (req, res, next) => {
  try {
    res.json({ items: await prisma.media.findMany({ orderBy: { id: 'desc' }, take: 100 }) });
  } catch (e) { next(e); }
});

export default r;
