import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { APP_VERSION, MIGRATION_BUNDLE_FORMAT, MIGRATION_TABLES, type MigrationManifest, type MigrationTable } from '@pos/contracts';
import archiver from 'archiver';
import { createHash } from 'crypto';
import { createReadStream, createWriteStream, existsSync, type WriteStream } from 'fs';
import { mkdtemp, readdir, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join, relative, sep } from 'path';
import { once } from 'events';
import { PrismaService } from '../prisma.service';
import { MetaService } from '../meta/meta.service';
import { uploadsDir } from '../common/uploads';

/** Rows read per query. */
const PAGE_SIZE = 1000;

/** A bundle's tables written to a temp folder, ready to be zipped and sent. */
export type PreparedExport = { dir: string; manifest: MigrationManifest };

type Delegate = { findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>> };

/** The Prisma client property for a model: SaleInvoice -> saleInvoice. */
const delegateName = (model: string) => model[0].toLowerCase() + model.slice(1);

function primaryKey(model: MigrationTable) {
  const definition = Prisma.dmmf.datamodel.models.find((m) => m.name === model);
  if (!definition) throw new Error(`Unknown model ${model}`);
  return definition.primaryKey?.fields ?? definition.fields.filter((field) => field.isId).map((field) => field.name);
}

async function write(stream: WriteStream, chunk: string) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

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

/**
 * Exports an offline business as the data bundle described in @pos/contracts (migration.ts),
 * for moving it online. Rows are read in one REPEATABLE READ transaction, so every table
 * comes from the same moment even if something writes meanwhile.
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaService
  ) {}

  /** Reasons an export can't run now, checked before anything is sent. */
  async assertCanExport() {
    if ((await this.meta.instanceStatus()) === 'ARCHIVED') {
      throw new ConflictException('This business has already moved online');
    }
    const open = await this.prisma.registerSession.findMany({
      where: { closedAt: null },
      select: { counter: { select: { name: true } }, user: { select: { username: true } } }
    });
    if (open.length) {
      const which = open.map((register) => `${register.counter.name} (${register.user.username})`).join(', ');
      throw new ConflictException(`Close the open register first: ${which}`);
    }
  }

  private async setStatus(status: 'ACTIVE' | 'MIGRATING' | 'ARCHIVED', data: Record<string, unknown> = {}) {
    await this.prisma.localInstance.upsert({
      where: { id: 'local' },
      update: { status, ...data },
      create: { id: 'local', status, ...data }
    });
    return { status };
  }

  /** Moving online starts: no register may be open, and nothing changes here until it ends. */
  async beginMove() {
    const status = await this.meta.instanceStatus();
    if (status === 'MIGRATING') return { status };
    await this.assertCanExport();
    return this.setStatus('MIGRATING');
  }

  async abortMove() {
    const status = await this.meta.instanceStatus();
    if (status === 'ARCHIVED') throw new ConflictException('This business has already moved online');
    return this.setStatus('ACTIVE');
  }

  async completeMove(target: { businessId: string; businessCode: string; server: string }) {
    const status = await this.meta.instanceStatus();
    if (status === 'ARCHIVED') return { status };
    if (status !== 'MIGRATING') throw new ConflictException('Start moving online first');
    return this.setStatus('ARCHIVED', {
      movedToBusinessId: target.businessId,
      movedToBusinessCode: target.businessCode,
      movedToServer: target.server,
      movedAt: new Date()
    });
  }

  /** Writes every table to a temp folder as NDJSON and builds the manifest. */
  async prepare(): Promise<PreparedExport> {
    const schemaVersion = await this.meta.schemaVersion();
    if (!schemaVersion) {
      throw new Error('The database has no applied migrations');
    }
    const dir = await mkdtemp(join(tmpdir(), 'pos-export-'));
    try {
      const tables = await this.prisma.$transaction(
        async (tx) => {
          const written: MigrationManifest['tables'] = [];
          for (const table of MIGRATION_TABLES) {
            written.push(await this.writeTable(tx, table, dir));
          }
          return written;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30 * 60 * 1000, maxWait: 10_000 }
      );

      const uploads: MigrationManifest['uploads'] = [];
      for (const path of await listFiles(uploadsDir)) {
        const file = ['uploads', ...relative(uploadsDir, path).split(sep)].join('/');
        const { size } = await stat(path);
        uploads.push({ file, bytes: size, sha256: await sha256OfFile(path) });
      }

      return {
        dir,
        manifest: {
          format: MIGRATION_BUNDLE_FORMAT,
          appVersion: APP_VERSION,
          schemaVersion,
          exportedAt: new Date().toISOString(),
          tables,
          uploads
        }
      };
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }

  /** Streams the zip: tables, uploads, then manifest.json. Removes the temp folder afterwards. */
  async stream(prepared: PreparedExport, out: NodeJS.WritableStream) {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const done = new Promise<void>((resolve, reject) => {
      archive.on('error', reject);
      archive.on('warning', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      out.on('close', resolve);
    });
    // Awaited below; this only stops an early failure from also being reported as unhandled.
    done.catch(() => undefined);
    archive.pipe(out);
    try {
      for (const table of prepared.manifest.tables) {
        archive.file(join(prepared.dir, `${table.name}.ndjson`), { name: table.file });
      }
      for (const upload of prepared.manifest.uploads) {
        archive.file(join(uploadsDir, ...upload.file.split('/').slice(1)), { name: upload.file });
      }
      archive.append(JSON.stringify(prepared.manifest, null, 2), { name: 'manifest.json' });
      await archive.finalize();
      await done;
    } catch (error) {
      this.logger.error(`Export failed while streaming: ${error instanceof Error ? error.message : String(error)}`);
      archive.abort();
      throw error;
    } finally {
      await rm(prepared.dir, { recursive: true, force: true });
    }
  }

  private async writeTable(tx: Prisma.TransactionClient, table: MigrationTable, dir: string) {
    const delegate = (tx as unknown as Record<string, Delegate>)[delegateName(table)];
    const keys = primaryKey(table);
    const orderBy = keys.map((key) => ({ [key]: 'asc' as const }));
    const stream = createWriteStream(join(dir, `${table}.ndjson`));
    const hash = createHash('sha256');
    let rows = 0;
    try {
      // Single-column keys page by key (fast on big tables); composite keys by offset.
      let lastId: unknown;
      for (;;) {
        const page = await delegate.findMany({
          orderBy,
          take: PAGE_SIZE,
          ...(keys.length === 1
            ? lastId === undefined
              ? {}
              : { cursor: { [keys[0]]: lastId }, skip: 1 }
            : { skip: rows })
        });
        for (const row of page) {
          // Decimals become strings and dates ISO strings, so nothing loses precision.
          const line = `${JSON.stringify(row)}\n`;
          hash.update(line);
          await write(stream, line);
        }
        rows += page.length;
        if (page.length < PAGE_SIZE) break;
        lastId = page[page.length - 1][keys[0]];
      }
    } finally {
      stream.end();
      await once(stream, 'close');
    }
    return { name: table, file: `tables/${table}.ndjson`, rows, sha256: hash.digest('hex') };
  }
}
