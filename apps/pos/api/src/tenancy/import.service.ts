import { ConflictException, Injectable, BadRequestException } from '@nestjs/common';
import {
  MIGRATION_TABLES,
  migrationManifestSchema,
  type MigrationImportResult,
  type MigrationManifest,
  type MigrationTable
} from '@pos/contracts';
import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { cp, mkdir, mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';
import { uploadsDir } from '../common/uploads';
import { extractZip } from '../common/zip';
import { latestBusinessMigration } from './migrator';
import { ProvisioningService } from './provisioning.service';
import type { ActiveBusiness } from './tenant-context';
import { TenancyService } from './tenancy.service';
import { TenantClients } from './tenant-clients';
import type { PrismaClient } from '@prisma/client';

/** Most a bundle may unpack to. */
const MAX_UNPACKED_BYTES = 4 * 1024 * 1024 * 1024;
const ROWS_PER_INSERT = 500;

/** Columns holding /uploads/... links, which move under the business's own folder. */
const UPLOAD_COLUMNS: Partial<Record<MigrationTable, string[]>> = {
  BusinessSettings: ['logoUrl'],
  Branch: ['logoUrl'],
  Item: ['imageUrl']
};

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function sha256OfFile(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Moves an offline business online: turns the bundle its desktop app exported
 * (@pos/contracts migration.ts) into a new business on this server.
 *
 * The bundle is data, never instructions: only the tables in MIGRATION_TABLES are read, in
 * that order (parents first) with foreign keys checked, and only into columns the table has.
 * Its uploads go under uploads/imported/<business id>/, so they can't replace another
 * business's files. Retrying with the same import id returns the same business.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly provisioning: ProvisioningService,
    private readonly clients: TenantClients
  ) {}

  /** A business already made from this import, if the first attempt's answer was lost. */
  private async previousAttempt(importId: string, accountId: string) {
    const existing = await this.tenancy.control.business.findUnique({
      where: { importId },
      select: { id: true, code: true, name: true, status: true, schemaName: true, memberships: { select: { accountId: true } } }
    });
    if (!existing) return null;
    if (!existing.memberships.some((membership) => membership.accountId === accountId) && existing.status === 'ACTIVE') {
      throw new ConflictException('This move was finished by another account');
    }
    if (existing.status === 'ACTIVE') return { business: { id: existing.id, code: existing.code, name: existing.name, status: 'ACTIVE' as const } };
    if (existing.status === 'PROVISIONING') throw new ConflictException('This move is still in progress; try again in a minute');
    // FAILED: clear it so this attempt can start over with the same id.
    await this.tenancy.control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${ident(existing.schemaName)} CASCADE`);
    await this.tenancy.control.business.delete({ where: { id: existing.id } });
    return null;
  }

  private async readManifest(work: string) {
    const parsed = migrationManifestSchema.safeParse(
      JSON.parse(await readFile(join(work, 'manifest.json'), 'utf8').catch(() => 'null'))
    );
    if (!parsed.success) throw new BadRequestException('This file is not an export from the Point of Sale app');
    const manifest = parsed.data;
    const latest = latestBusinessMigration();
    if (manifest.schemaVersion !== latest) {
      throw new ConflictException(
        manifest.schemaVersion < (latest ?? '')
          ? 'This app is older than the server. Update the app, then move online.'
          : "The server hasn't been updated to this app's version yet. Try again later."
      );
    }
    const names = manifest.tables.map((table) => table.name);
    if (names.length !== MIGRATION_TABLES.length || names.some((name, i) => name !== MIGRATION_TABLES[i])) {
      throw new BadRequestException("The export's tables don't match this server's");
    }
    for (const table of manifest.tables) {
      if (table.file !== `tables/${table.name}.ndjson` || (await sha256OfFile(join(work, table.file)).catch(() => '')) !== table.sha256) {
        throw new BadRequestException(`The export is damaged (${table.name})`);
      }
    }
    for (const upload of manifest.uploads) {
      const parts = upload.file.split('/');
      if (parts[0] !== 'uploads' || (await sha256OfFile(join(work, ...parts)).catch(() => '')) !== upload.sha256) {
        throw new BadRequestException(`The export is damaged (${upload.file})`);
      }
    }
    return manifest;
  }

  private async businessName(work: string) {
    const first = (await readFile(join(work, 'tables', 'BusinessSettings.ndjson'), 'utf8')).split('\n').find(Boolean);
    const name = first ? (JSON.parse(first) as { name?: unknown }).name : null;
    return typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : 'My Business';
  }

  /** Rows into the new schema: parents first, foreign keys checked, counts compared. */
  private async loadRows(business: ActiveBusiness, work: string, manifest: MigrationManifest) {
    // Held for the whole load, so the client isn't dropped while other businesses come and go.
    const { client, release } = await this.clients.acquire(business);
    try {
      await this.loadRowsWith(client, business, work, manifest);
    } finally {
      release();
    }
  }

  private async loadRowsWith(client: PrismaClient, business: ActiveBusiness, work: string, manifest: MigrationManifest) {
    const uploadPrefix = `/uploads/imported/${business.id}/`;
    await client.$transaction(
      async (tx) => {
        // Migrations insert a few rows (the default business settings); the export has its own.
        await tx.$executeRawUnsafe(`TRUNCATE ${MIGRATION_TABLES.map(ident).join(', ')} CASCADE`);
        for (const table of manifest.tables) {
          const rewrite = UPLOAD_COLUMNS[table.name];
          const insert = (batch: string[]) =>
            tx.$executeRawUnsafe(
              `INSERT INTO ${ident(table.name)} SELECT * FROM json_populate_recordset(NULL::${ident(table.name)}, $1::json)`,
              `[${batch.join(',')}]`
            );
          let batch: string[] = [];
          for await (const raw of createInterface({ input: createReadStream(join(work, table.file)), crlfDelay: Infinity })) {
            if (!raw) continue;
            let line = raw;
            if (rewrite) {
              // Decimals are strings in the export, so parsing and re-writing loses nothing.
              const row = JSON.parse(raw) as Record<string, unknown>;
              for (const column of rewrite) {
                const value = row[column];
                if (typeof value === 'string' && value.startsWith('/uploads/')) row[column] = uploadPrefix + value.slice('/uploads/'.length);
              }
              line = JSON.stringify(row);
            }
            batch.push(line);
            if (batch.length === ROWS_PER_INSERT) {
              await insert(batch);
              batch = [];
            }
          }
          if (batch.length) await insert(batch);
          const [{ count }] = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM ${ident(table.name)}`);
          if (Number(count) !== table.rows) {
            throw new BadRequestException(`Loading ${table.name} gave ${count} rows; the export has ${table.rows}`);
          }
        }
      },
      { timeout: 30 * 60 * 1000, maxWait: 30_000 }
    );
  }

  async importBundle(file: string, options: { accountId: string; importId: string }): Promise<MigrationImportResult> {
    const previous = await this.previousAttempt(options.importId, options.accountId);
    if (previous) return previous;

    const work = await mkdtemp(join(tmpdir(), 'pos-import-'));
    try {
      await extractZip(file, work, MAX_UNPACKED_BYTES).catch((error: Error) => {
        throw new BadRequestException(error.message);
      });
      const manifest = await this.readManifest(work);
      const business = await this.provisioning.reserve(await this.businessName(work), { importId: options.importId });
      try {
        await this.provisioning.createSchema(business);
        await this.loadRows(business, work, manifest);
        if (existsSync(join(work, 'uploads'))) {
          const target = join(uploadsDir, 'imported', business.id);
          await mkdir(target, { recursive: true });
          await cp(join(work, 'uploads'), target, { recursive: true });
        }
        await this.provisioning.activate(business, options.accountId);
        return { business: { id: business.id, code: business.code, name: business.name, status: 'ACTIVE' } };
      } catch (error) {
        await this.provisioning.discard(business, error);
        await rm(join(uploadsDir, 'imported', business.id), { recursive: true, force: true });
        throw error;
      }
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}
