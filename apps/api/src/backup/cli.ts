// Backups for the desktop app's offline mode, run by the app as a separate process:
//   node dist/backup/cli.js backup  --dir D --uploads U --days N --reason daily|manual|before-restore
//                                   [--skip-if-today] [--before-update <latest bundled migration>]
//   node dist/backup/cli.js restore --file F --uploads U
//   node dist/backup/cli.js list    --dir D
//   node dist/backup/cli.js prune   --dir D --days N
// DATABASE_URL names the database. The last line printed is the result as JSON:
// {"ok":true,...} or {"ok":false,"error":"..."} (exit code 1).
import { PrismaClient } from '@prisma/client';
import { APP_VERSION } from '@pos/contracts';
import { join } from 'path';
import {
  appliedSchemaVersion,
  BACKUP_REASONS,
  type BackupReason,
  clampBackupDays,
  createBackup,
  listBackups,
  localDay,
  pruneBackups,
  restoreBackup
} from './local-backup';

const apiRoot = join(__dirname, '..', '..');

function options(args: string[]) {
  const found: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) found[key.slice(2)] = true;
    else {
      found[key.slice(2)] = next;
      i += 1;
    }
  }
  return found;
}

function required(found: Record<string, string | true>, name: string) {
  const value = found[name];
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`);
  return value;
}

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

const log = (message: string) => process.stdout.write(`${message}\n`);

async function backup(found: Record<string, string | true>) {
  const dir = required(found, 'dir');
  const reason = required(found, 'reason') as BackupReason;
  if (!BACKUP_REASONS.includes(reason)) throw new Error(`Unknown reason: ${reason}`);
  const days = clampBackupDays(found.days);
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
  try {
    const schemaVersion = await appliedSchemaVersion(prisma);
    if (!schemaVersion) return { skipped: 'The database is empty' };
    // About to apply a newer version's migrations: always keep a copy from before.
    const beforeUpdate = typeof found['before-update'] === 'string' && schemaVersion < found['before-update'];
    const today = localDay(new Date());
    if (!beforeUpdate && found['skip-if-today'] && (await listBackups(dir)).some((b) => b.date === today)) {
      return { skipped: "Today's backup already exists", removed: await pruneBackups(dir, days) };
    }
    const file = await createBackup({
      prisma,
      dir,
      uploadsDir: required(found, 'uploads'),
      reason: beforeUpdate ? 'before-update' : reason,
      appVersion: APP_VERSION
    });
    return { file, removed: await pruneBackups(dir, days) };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const found = options(rest);
  switch (command) {
    case 'backup':
      return backup(found);
    case 'restore': {
      const manifest = await restoreBackup({
        file: required(found, 'file'),
        databaseUrl: databaseUrl(),
        uploadsDir: required(found, 'uploads'),
        apiRoot,
        log
      });
      return { schemaVersion: manifest.schemaVersion, createdAt: manifest.createdAt };
    }
    case 'list':
      return {
        backups: (await listBackups(required(found, 'dir'))).map(({ file, createdAt, reason, bytes }) => ({
          file,
          createdAt: createdAt.toISOString(),
          reason,
          bytes
        }))
      };
    case 'prune':
      return { removed: await pruneBackups(required(found, 'dir'), clampBackupDays(found.days)) };
    default:
      throw new Error(`Unknown command: ${command ?? '(none)'}`);
  }
}

main().then(
  (result) => {
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    process.exit(0);
  },
  (error: unknown) => {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exit(1);
  }
);
