import fs from 'fs';
import path from 'path';
import multer from 'multer';
import type { Request } from 'express';

const uploadsRoot = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(uploadsRoot, { recursive: true });

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
}

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    const folder = path.join(uploadsRoot, safeSegment(file.fieldname || 'general'));
    fs.mkdirSync(folder, { recursive: true });
    cb(null, folder);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Only image uploads are allowed'));
}

export const imageUpload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter
});

export function publicFileUrl(req: Request, absolutePath: string) {
  const relative = path.relative(uploadsRoot, absolutePath).split(path.sep).join('/');
  return `${req.protocol}://${req.get('host')}/uploads/${relative}`;
}


function documentFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ok = file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';
  if (ok) cb(null, true);
  else cb(new Error('Only images and PDFs are allowed'));
}

export const documentUpload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: documentFilter
});
