import { Prisma, PrismaClient } from '@prisma/client';
import archiver from 'archiver';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { once } from 'events';
import { createReadStream, createWriteStream, existsSync, type WriteStream } from 'fs';
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { createInterface } from 'readline';
import { createRequire } from 'module';
import { dirname, join, relative, sep } from 'path';
import yauzl from 'yauzl';

/**
 * Backups of an offline (desktop) business, kept on the same computer.
 *
 * The bundled PostgreSQL has no pg_dump, so a backup is written here: a zip holding
 * manifest.json, one tables/<table>.ndjson per table (each row as PostgreSQL's own
 * row_to_json text, read back exactly by json_populate_recordset) and uploads/**. Every
 * table is read from one snapshot, so the shop can keep selling while it runs.
 *
 * A restore never touches the live database until the end: it builds a new database at the
 * backup's schema version, loads the rows, then swaps it in by renaming. Migrations then
 * bring it up to date, so backups made before an app update can still be restored.
 */

export const BACKUP_KIND = 'pos-local-backup';
export const BACKUP_FORMAT = 1;
export const BACKUP_REASONS = ['daily', 'manual', 'before-update', 'before-restore', 'before-move'] as const;
export type BackupReason = (typeof BACKUP_REASONS)[number];

/** How many days of backups a user may keep. */
export const BACKUP_DAYS = { min: 2, max: 5, default: 3 } as const;

export type BackupManifest = {
  kind: typeof BACKUP_KIND;
  format: typeof BACKUP_FORMAT;
  appVersion: string;
  /** The last migration applied when the backup was made. */
  schemaVersion: string;
  createdAt: string;
  reason: BackupReason;
  tables: Array<{ name: string; file: string; rows: number; sha256: string }>;
  uploads: Array<{ file: string; bytes: number; sha256: string }>;
};

export type BackupFile = { file: string; path: string; date: string; createdAt: Date; reason: BackupReason; bytes: number };

const FILE_PATTERN = /^pos-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})-([a-z-]+)\.zip$/;
const ROWS_PER_FETCH = 1000;
const ROWS_PER_INSERT = 500;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** YYYY-MM-DD in this computer's time zone. */
export const localDay = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

export function backupFileName(reason: BackupReason, at = new Date()) {
  return `pos-backup-${localDay(at)}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}-${reason}.zip`;
}

export function clampBackupDays(value: unknown) {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days)) return BACKUP_DAYS.default;
  return Math.min(BACKUP_DAYS.max, Math.max(BACKUP_DAYS.min, days));
}

/** A double-quoted SQL identifier. */
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function sha256OfFile(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function listFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : entry.isFile() ? [join(dir, entry.name)] : []))
  );
  return nested.flat().sort();
}

async function write(stream: WriteStream, chunk: string) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

/** Backups in `dir`, newest first. Files not named like a backup are ignored. */
export async function listBackups(dir: string): Promise<BackupFile[]> {
  if (!existsSync(dir)) return [];
  const found: BackupFile[] = [];
  for (const file of await readdir(dir)) {
    const match = FILE_PATTERN.exec(file);
    if (!match) continue;
    const [, y, mo, d, h, mi, s, reason] = match;
    if (!(BACKUP_REASONS as readonly string[]).includes(reason)) continue;
    const path = join(dir, file);
    found.push({
      file,
      path,
      date: `${y}-${mo}-${d}`,
      createdAt: new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
      reason: reason as BackupReason,
      bytes: (await stat(path)).size
    });
  }
  return found.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Deletes backups older than the last `days` calendar days (today counts as one). The
 * newest backup is always kept, however old, so a computer left off for a week still has one.
 */
export async function pruneBackups(dir: string, days: number, now = new Date()) {
  const keepDays = clampBackupDays(days);
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (keepDays - 1));
  const backups = await listBackups(dir);
  const removed: string[] = [];
  for (const backup of backups.slice(1)) {
    if (backup.date < localDay(cutoff)) {
      await rm(backup.path, { force: true });
      removed.push(backup.file);
    }
  }
  return removed;
}

/** The last migration applied to the database, or null when it has none yet. */
export async function appliedSchemaVersion(prisma: PrismaClient) {
  const [{ exists }] = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT to_regclass('"_prisma_migrations"') IS NOT NULL AS exists`;
  if (!exists) return null;
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT migration_name AS name FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY migration_name DESC LIMIT 1`;
  return rows[0]?.name ?? null;
}

/** Every table of the business, whatever this version of the app knows about. */
async function businessTables(client: PrismaClient | Prisma.TransactionClient) {
  const rows = await client.$queryRaw<Array<{ name: string }>>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
    ORDER BY table_name`;
  return rows.map((row) => row.name);
}

/** Writes a backup into `dir` and returns its path. */
export async function createBackup(options: {
  prisma: PrismaClient;
  dir: string;
  uploadsDir: string;
  reason: BackupReason;
  appVersion: string;
  now?: Date;
}) {
  const { prisma, dir, uploadsDir, reason, appVersion } = options;
  const schemaVersion = await appliedSchemaVersion(prisma);
  if (!schemaVersion) {
    throw new Error('The database has no tables yet, so there is nothing to back up');
  }
  const createdAt = options.now ?? new Date();
  const work = await mkdtemp(join(tmpdir(), 'pos-backup-'));
  try {
    const tables = await prisma.$transaction(
      async (tx) => {
        const written: BackupManifest['tables'] = [];
        for (const name of await businessTables(tx)) {
          const file = join(work, `${name}.ndjson`);
          const stream = createWriteStream(file);
          const hash = createHash('sha256');
          let rows = 0;
          try {
            await tx.$executeRawUnsafe(`DECLARE backup_rows NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS line FROM ${ident(name)} t`);
            for (;;) {
              const page = await tx.$queryRawUnsafe<Array<{ line: string }>>(`FETCH ${ROWS_PER_FETCH} FROM backup_rows`);
              for (const { line } of page) {
                hash.update(`${line}\n`);
                await write(stream, `${line}\n`);
              }
              rows += page.length;
              if (page.length < ROWS_PER_FETCH) break;
            }
            await tx.$executeRawUnsafe('CLOSE backup_rows');
          } finally {
            stream.end();
            await once(stream, 'close');
          }
          written.push({ name, file: `tables/${name}.ndjson`, rows, sha256: hash.digest('hex') });
        }
        return written;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30 * 60 * 1000, maxWait: 30_000 }
    );

    const uploads: BackupManifest['uploads'] = [];
    for (const path of await listFiles(uploadsDir)) {
      const file = ['uploads', ...relative(uploadsDir, path).split(sep)].join('/');
      uploads.push({ file, bytes: (await stat(path)).size, sha256: await sha256OfFile(path) });
    }
    const manifest: BackupManifest = {
      kind: BACKUP_KIND,
      format: BACKUP_FORMAT,
      appVersion,
      schemaVersion,
      createdAt: createdAt.toISOString(),
      reason,
      tables,
      uploads
    };

    await mkdir(dir, { recursive: true });
    const target = join(dir, backupFileName(reason, createdAt));
    // Written under another name first: a half-written file never looks like a backup.
    const partial = `${target}.partial`;
    const out = createWriteStream(partial);
    const archive = archiver('zip', { zlib: { level: 6 } });
    const finished = new Promise<void>((resolve, reject) => {
      archive.on('error', reject);
      out.on('error', reject);
      out.on('close', resolve);
    });
    finished.catch(() => undefined);
    archive.pipe(out);
    for (const table of tables) archive.file(join(work, `${table.name}.ndjson`), { name: table.file });
    for (const upload of uploads) archive.file(join(uploadsDir, ...upload.file.split('/').slice(1)), { name: upload.file });
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    await archive.finalize();
    await finished;
    await rename(partial, target);
    return target;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Unpacks a backup into `tablesDir` (tables, manifest) and `uploadsDir` (uploads/**). */
function extractBackup(file: string, tablesDir: string, uploadsDir: string) {
  return new Promise<void>((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('Not a backup file'));
      zip.on('error', reject);
      zip.on('end', () => resolve());
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName;
        if (name.endsWith('/')) return zip.readEntry();
        const parts = name.split('/');
        if (parts.some((part) => part === '..' || part === '') || name.startsWith('/') || name.includes('\\')) {
          return reject(new Error(`Unexpected file in backup: ${name}`));
        }
        const target = parts[0] === 'uploads' ? join(uploadsDir, ...parts.slice(1)) : join(tablesDir, ...parts);
        zip.openReadStream(entry, async (streamError, stream) => {
          if (streamError || !stream) return reject(streamError);
          try {
            await mkdir(dirname(target), { recursive: true });
            const out = createWriteStream(target);
            stream.pipe(out);
            await once(out, 'close');
            zip.readEntry();
          } catch (writeError) {
            reject(writeError);
          }
        });
      });
      zip.readEntry();
    });
  });
}

function parseManifest(text: string): BackupManifest {
  const manifest = JSON.parse(text) as BackupManifest;
  if (manifest?.kind !== BACKUP_KIND || manifest.format !== BACKUP_FORMAT || !Array.isArray(manifest.tables)) {
    throw new Error('This file is not a Point of Sale backup');
  }
  for (const table of manifest.tables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table.name) || table.file !== `tables/${table.name}.ndjson`) {
      throw new Error(`Unexpected table in backup: ${table.name}`);
    }
  }
  return manifest;
}

/** The migration folders this version of the app ships, oldest first. */
async function migrationNames(migrationsDir: string) {
  return (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** A backup can only be restored by an app that ships the migration it was made at. */
export async function assertRestorable(manifest: BackupManifest, migrationsDir: string) {
  if (!(await migrationNames(migrationsDir)).includes(manifest.schemaVersion)) {
    throw new Error(
      `This backup was made by a newer version of the app (${manifest.appVersion}). Update the app, then restore it.`
    );
  }
}

/**
 * Runs `prisma migrate deploy` with only the migrations up to `upTo`, so a database can be
 * built at exactly the schema a backup was made at.
 */
export async function migrateDatabaseUpTo(databaseUrl: string, apiRoot: string, upTo: string, work: string) {
  const schemaPath = join(apiRoot, 'prisma', 'schema.prisma');
  const migrationsDir = join(apiRoot, 'prisma', 'migrations');
  const prismaDir = join(work, 'prisma');
  await mkdir(join(prismaDir, 'migrations'), { recursive: true });
  await copyFile(schemaPath, join(prismaDir, 'schema.prisma'));
  await copyFile(join(migrationsDir, 'migration_lock.toml'), join(prismaDir, 'migrations', 'migration_lock.toml'));
  for (const name of await migrationNames(migrationsDir)) {
    if (name <= upTo) await cp(join(migrationsDir, name), join(prismaDir, 'migrations', name), { recursive: true });
  }
  const prismaCli = createRequire(join(apiRoot, 'package.json')).resolve('prisma/build/index.js');
  await new Promise<void>((resolve, reject) => {
    // process.execPath: node, or the desktop app's binary running as node.
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', join(prismaDir, 'schema.prisma')], {
      env: { ...process.env, DATABASE_URL: databaseUrl, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Preparing the database failed: ${output.trim().split('\n').slice(-5).join(' ')}`))
    );
  });
}

/** The same server, another database. */
function withDatabase(databaseUrl: string, database: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Replaces the business (database rows and uploads) with a backup's. Nothing else may be
 * using the database meanwhile: the desktop app stops its API first. Any failure before the
 * final swap leaves the current data exactly as it was.
 */
export async function restoreBackup(options: {
  file: string;
  databaseUrl: string;
  uploadsDir: string;
  /** apps/api: its prisma/ folder holds the schema and migrations this version ships. */
  apiRoot: string;
  log?: (message: string) => void;
}) {
  const { file, databaseUrl, uploadsDir, apiRoot } = options;
  const migrationsDir = join(apiRoot, 'prisma', 'migrations');
  const log = options.log ?? (() => undefined);
  const database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  const restoring = `${database}_restore`;
  const previous = `${database}_before_restore`;
  const incomingUploads = `${uploadsDir}.restoring`;
  const work = await mkdtemp(join(tmpdir(), 'pos-restore-'));
  // Server-level work (create, rename, drop databases) happens from another database.
  const admin = new PrismaClient({ datasourceUrl: withDatabase(databaseUrl, 'template1') });

  try {
    log('Checking the backup');
    await rm(incomingUploads, { recursive: true, force: true });
    await extractBackup(file, work, incomingUploads);
    const manifest = parseManifest(await readFile(join(work, 'manifest.json'), 'utf8'));
    await assertRestorable(manifest, migrationsDir);
    for (const table of manifest.tables) {
      if ((await sha256OfFile(join(work, table.file))) !== table.sha256) {
        throw new Error(`The backup is damaged (${table.name} doesn't match its checksum)`);
      }
    }
    for (const upload of manifest.uploads) {
      const path = join(incomingUploads, ...upload.file.split('/').slice(1));
      if (!existsSync(path) || (await sha256OfFile(path)) !== upload.sha256) {
        throw new Error(`The backup is damaged (${upload.file} doesn't match its checksum)`);
      }
    }

    log(`Building a database at ${manifest.schemaVersion}`);
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${ident(restoring)} WITH (FORCE)`);
    // From template0: template1 can't be copied while this connection is using it.
    await admin.$executeRawUnsafe(`CREATE DATABASE ${ident(restoring)} TEMPLATE template0 ENCODING 'UTF8'`);
    const restoringUrl = withDatabase(databaseUrl, restoring);
    await migrateDatabaseUpTo(restoringUrl, apiRoot, manifest.schemaVersion, work);

    log('Loading the rows');
    const target = new PrismaClient({ datasourceUrl: restoringUrl });
    try {
      await target.$transaction(
        async (tx) => {
          // Foreign keys are checked once all tables are loaded, not row by row in file order.
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          const known = new Set(await businessTables(tx));
          // Some migrations insert rows (the default business settings); the backup has its own.
          if (known.size) {
            await tx.$executeRawUnsafe(`TRUNCATE ${[...known].map(ident).join(', ')} CASCADE`);
          }
          for (const table of manifest.tables) {
            if (!known.has(table.name)) throw new Error(`The backup has a table this database doesn't: ${table.name}`);
            const insert = (batch: string[]) =>
              tx.$executeRawUnsafe(
                `INSERT INTO ${ident(table.name)} SELECT * FROM json_populate_recordset(NULL::${ident(table.name)}, $1::json)`,
                `[${batch.join(',')}]`
              );
            let batch: string[] = [];
            for await (const line of createInterface({ input: createReadStream(join(work, table.file)), crlfDelay: Infinity })) {
              if (!line) continue;
              batch.push(line);
              if (batch.length === ROWS_PER_INSERT) {
                await insert(batch);
                batch = [];
              }
            }
            if (batch.length) await insert(batch);
            const [{ count }] = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM ${ident(table.name)}`);
            if (Number(count) !== table.rows) {
              throw new Error(`Loading ${table.name} gave ${count} rows, the backup has ${table.rows}`);
            }
          }
        },
        { timeout: 30 * 60 * 1000, maxWait: 30_000 }
      );
    } finally {
      await target.$disconnect();
    }

    log('Swapping in the restored data');
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${ident(previous)} WITH (FORCE)`);
    // WITH (FORCE) isn't available on RENAME, so close any leftover connections first.
    await admin.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${database} AND pid <> pg_backend_pid()`;
    await admin.$executeRawUnsafe(`ALTER DATABASE ${ident(database)} RENAME TO ${ident(previous)}`);
    try {
      await admin.$executeRawUnsafe(`ALTER DATABASE ${ident(restoring)} RENAME TO ${ident(database)}`);
    } catch (error) {
      await admin.$executeRawUnsafe(`ALTER DATABASE ${ident(previous)} RENAME TO ${ident(database)}`);
      throw error;
    }
    await admin.$executeRawUnsafe(`DROP DATABASE ${ident(previous)} WITH (FORCE)`);

    await mkdir(incomingUploads, { recursive: true });
    await rm(`${uploadsDir}.before-restore`, { recursive: true, force: true });
    if (existsSync(uploadsDir)) await rename(uploadsDir, `${uploadsDir}.before-restore`);
    await rename(incomingUploads, uploadsDir);
    await rm(`${uploadsDir}.before-restore`, { recursive: true, force: true });
    log('Restore finished');
    return manifest;
  } catch (error) {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${ident(restoring)} WITH (FORCE)`).catch(() => undefined);
    await rm(incomingUploads, { recursive: true, force: true });
    throw error;
  } finally {
    await admin.$disconnect();
    await rm(work, { recursive: true, force: true });
  }
}
