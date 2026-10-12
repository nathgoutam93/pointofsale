import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync } from 'fs';
import { join } from 'path';
import { uploadsDir } from '../src/common/uploads';
import { startApp, type TestApp } from './helpers';

// Image uploads: only real PNG, JPEG or WebP (by content, whatever the browser says), saved with
// the matching extension, never before the uploader is allowed to, and served with nosniff.
let t: TestApp;
let admin: string;
beforeAll(async () => { t = await startApp(); admin = await t.login(); });
afterAll(async () => { await t.close(); });

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ff9f0100050001ff0c2e8a7e0000000049454e44ae426082', 'hex');
const upload = (path: string, token: string, bytes: Buffer, type: string, name: string) => {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  return fetch(t.baseUrl + path, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
};

describe('image uploads', () => {
  it('keeps real images under their own extension and serves them with nosniff', async () => {
    const res = await upload('/items/upload-image', admin, PNG, 'image/jpeg', 'photo.jpg');
    expect(res.status).toBe(201);
    const { path } = (await res.json()) as { path: string };
    expect(path).toMatch(/^\/uploads\/items\/[0-9a-f]{32}\.png$/);
    const served = await fetch(t.baseUrl + path);
    expect(served.status).toBe(200);
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-type')).toBe('image/png');
  });

  it('refuses SVG and HTML whatever type the browser claims', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    for (const [bytes, type, name] of [
      [svg, 'image/svg+xml', 'logo.svg'],
      [html, 'image/png', 'logo.png']
    ] as const) {
      const res = await upload('/business/logo', admin, bytes, type, name);
      expect(res.status, name).toBe(400);
      expect(((await res.json()) as { message: string }).message).toMatch(/Only PNG, JPEG or WebP/);
    }
  });

  it('checks who may upload before saving anything', async () => {
    const ctx = await t.branchWithRegister(admin);
    const cashier = await t.cashierWithRegister(admin, ctx.branch.id);
    const files = () => readdirSync(join(uploadsDir, 'items')).length;
    const before = files();
    const res = await upload('/items/upload-image', cashier.token, PNG, 'image/png', 'x.png');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toMatch(/aren't allowed/);
    expect(files()).toBe(before);
  });
});
