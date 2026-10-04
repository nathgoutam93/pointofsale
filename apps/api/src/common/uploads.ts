import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { writeFile } from 'fs/promises';
import { join } from 'path';

/** Where uploaded logos and item images are stored (served at /uploads/). */
export const uploadsDir = process.env.UPLOADS_DIR ? process.env.UPLOADS_DIR : join(process.cwd(), 'uploads');

/** The largest image accepted, in bytes. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Multer settings for an image upload: kept in memory (nothing is written before the handler has
 * checked who may upload), at most MAX_IMAGE_BYTES. The handler saves it with saveImage.
 */
export const imageUploadOptions = { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } };

/** What an image file really is, from its first bytes; null for anything else (SVG, HTML...). */
export function imageTypeOf(bytes: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Saves an uploaded image under uploads/<folder>/ with a random name and the extension its
 * content says (PNG, JPEG or WebP only, whatever the browser claimed), and answers its
 * /uploads/... path.
 */
export async function saveImage(file: { buffer?: Buffer } | undefined, folder: 'items' | 'branches' | 'business') {
  if (!file?.buffer?.length) throw new BadRequestException('Image file is required');
  const type = imageTypeOf(file.buffer);
  if (!type) throw new BadRequestException('Only PNG, JPEG or WebP images are allowed');
  const name = `${randomBytes(16).toString('hex')}.${type}`;
  await writeFile(join(uploadsDir, folder, name), file.buffer);
  return `/uploads/${folder}/${name}`;
}

/**
 * Headers for every file served from /uploads/: never sniffed as another type, and an SVG
 * saved by an older version can't run scripts when opened on its own.
 */
export function uploadHeaders(res: { setHeader(name: string, value: string): void }, path: string) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (path.toLowerCase().endsWith('.svg')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  }
}
