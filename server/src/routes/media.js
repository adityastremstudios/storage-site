import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { authenticate, minRole } from '../middleware/auth.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsDir = path.resolve(dirname, '../../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// The old filter trusted file.mimetype, which the client controls. Uploading
// "evil.html" with Content-Type: image/png kept the .html extension, and
// /uploads is served statically — stored XSS on the admin panel's own origin.
// We now sniff the real magic bytes and force the extension to match.
const SIGNATURES = [
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.slice(0, 3).toString('latin1') === 'GIF' },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP',
  },
];

function sniff(buffer) {
  if (!buffer || buffer.length < 12) return null;
  return SIGNATURES.find((s) => s.test(buffer)) || null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

const r = Router();
r.use(authenticate);

r.post('/', minRole('DATA_ENTRY'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Attach an image in the "file" field' });

    const kind = sniff(req.file.buffer);
    if (!kind) {
      return res.status(400).json({ error: 'Only real JPG, PNG, GIF or WEBP images are accepted' });
    }

    const base = path.basename(req.file.originalname, path.extname(req.file.originalname))
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(-50) || 'image';
    const filename = `${Date.now()}-${base}.${kind.ext}`;
    const target = path.join(uploadsDir, filename);

    // Defence in depth: never let a crafted name escape the uploads directory.
    if (path.dirname(path.resolve(target)) !== path.resolve(uploadsDir)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    await fsp.writeFile(target, req.file.buffer);
    const url = `/uploads/${filename}`;
    const media = await prisma.media.create({
      data: { url, key: filename, type: kind.mime, size: req.file.size, uploadedById: req.user.id },
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
