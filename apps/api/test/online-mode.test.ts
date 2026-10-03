import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { APP_VERSION, MIGRATION_EXCLUDED_MODELS, MIGRATION_TABLES } from '@pos/contracts';
import { startApp, type TestApp } from './helpers';

// The hosted server (POS_MODE unset): the offline-only routes don't exist.
let t: TestApp;
let admin: string;
beforeAll(async () => { t = await startApp(); admin = await t.login(); });
afterAll(async () => { await t.close(); });

describe('online mode', () => {
  it('reports its mode and versions', async () => {
    expect(await t.ok('GET', '/meta')).toEqual({
      appVersion: APP_VERSION,
      schemaVersion: expect.stringMatching(/^\d{14}_/),
      mode: 'online',
      minClientVersion: null,
      setupRequired: false,
      instanceStatus: null,
      movedTo: null
    });
  });

  it('has no first-run setup or export', async () => {
    // 404 before validation, so an empty body doesn't reveal that the route exists.
    expect((await t.call('POST', '/setup', null, {})).status).toBe(404);
    expect((await t.call('GET', '/migration/export', admin)).status).toBe(404);
  });

  it('ignores the offline read-only flag', async () => {
    await t.db.localInstance.upsert({ where: { id: 'local' }, update: { status: 'ARCHIVED' }, create: { id: 'local', status: 'ARCHIVED' } });
    try {
      expect((await t.call('PATCH', '/business/settings', admin, {})).status).toBe(200);
    } finally {
      await t.db.localInstance.delete({ where: { id: 'local' } });
    }
  });
});

describe('minimum app version', () => {
  const asApp = (version: string | null, path: string) =>
    fetch(t.baseUrl + path, {
      headers: { authorization: `Bearer ${admin}`, ...(version ? { 'x-pos-client-version': version } : {}) }
    });

  it('turns away apps older than MIN_CLIENT_VERSION with 426, and lets them read /meta', async () => {
    process.env.MIN_CLIENT_VERSION = '0.10.0';
    try {
      const old = await asApp('0.9.5', '/business/settings');
      expect(old.status).toBe(426);
      expect(await old.json()).toMatchObject({ minClientVersion: '0.10.0', message: expect.stringMatching(/Update to version 0\.10\.0/) });

      expect((await asApp('0.10.0', '/business/settings')).status).toBe(200);
      expect((await asApp('1.0.0', '/business/settings')).status).toBe(200);
      // Browsers load the web app from the server itself and send no version.
      expect((await asApp(null, '/business/settings')).status).toBe(200);

      const meta = await asApp('0.9.5', '/meta');
      expect(meta.status).toBe(200);
      expect((await meta.json()).minClientVersion).toBe('0.10.0');
    } finally {
      delete process.env.MIN_CLIENT_VERSION;
    }
    expect((await asApp('0.0.1', '/business/settings')).status).toBe(200);
  });
});

describe('migration bundle tables', () => {
  const models = Prisma.dmmf.datamodel.models;

  it('lists every model, or excludes it on purpose', () => {
    const listed = new Set<string>([...MIGRATION_TABLES, ...MIGRATION_EXCLUDED_MODELS]);
    expect(models.map((model) => model.name).filter((name) => !listed.has(name))).toEqual([]);
    expect([...listed].filter((name) => !models.some((model) => model.name === name))).toEqual([]);
  });

  it('puts every table after the tables it references', () => {
    const position = new Map<string, number>(MIGRATION_TABLES.map((name, index) => [name, index]));
    for (const model of models.filter((m) => position.has(m.name))) {
      for (const field of model.fields.filter((f) => f.relationFromFields?.length)) {
        expect(position.get(field.type), `${model.name}.${field.name}`).toBeLessThan(position.get(model.name)!);
      }
    }
  });
});
