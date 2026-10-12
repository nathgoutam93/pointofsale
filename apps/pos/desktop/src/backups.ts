import { existsSync, statSync } from 'fs';
import { copyFile, rename, rm } from 'fs/promises';
import { basename, join } from 'path';
import { baseEnv, latestMigration, runScript } from './api-server.js';
import type { Logger } from './log.js';
import { paths } from './paths.js';

export type BackupEntry = {
  file: string;
  createdAt: string;
  reason: 'daily' | 'manual' | 'before-update' | 'before-restore' | 'before-move' | 'export';
  bytes: number;
};

type CliResult = { ok: boolean; error?: string; file?: string; skipped?: string; removed?: string[]; backups?: BackupEntry[] };

/** Backups live next to the business data, in userData/backups. */
export const backupsFolder = () => join(paths.userData(), 'backups');

/**
 * Local backups of an offline business, done by the API's backup tool (apps/pos/api
 * src/backup/cli.ts) so the database work stays in one place. One operation at a time: a
 * backup never overlaps a restore.
 */
export class Backups {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly log: Logger,
    private readonly databaseUrl: () => string,
    private readonly days: () => number,
    /** The second folder backups are copied to, and where to record how each copy went. */
    private readonly copies: {
      folder: () => string | null;
      record: (status: { ok: boolean; file: string | null; error: string | null }) => void;
    }
  ) {}

  /**
   * Copies a backup to the second folder, then keeps only its last few days there too. Written
   * under another name first, so a half-copied file never looks like a backup. A missing folder
   * (USB drive unplugged) is recorded, not thrown: the backup itself still succeeded.
   */
  private async copyOffsite(file: string) {
    const folder = this.copies.folder();
    if (!folder) return;
    const target = join(folder, basename(file));
    try {
      if (!existsSync(folder) || !statSync(folder).isDirectory()) {
        throw new Error("The folder isn't available. Is the drive plugged in?");
      }
      await copyFile(file, `${target}.partial`);
      await rename(`${target}.partial`, target);
      await this.cli(['prune', '--dir', folder, '--days', String(this.days())], 'Removing old copies failed');
      this.copies.record({ ok: true, file: basename(file), error: null });
      this.log(`Copied ${basename(file)} to ${folder}`);
    } catch (error) {
      await rm(`${target}.partial`, { force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      this.copies.record({ ok: false, file: basename(file), error: message });
      this.log(`Copying ${basename(file)} to ${folder} failed: ${message}`);
    }
  }

  /** After a backup is written: its copy in the second folder. */
  private async withCopy(result: CliResult) {
    if (result.file) await this.copyOffsite(result.file);
    return result;
  }

  /** The newest backup into the second folder (when it's chosen, or after a failed copy). */
  copyLatest() {
    return this.serial(async () => {
      const [latest] = (await this.cli(['list', '--dir', backupsFolder()], 'Listing backups failed')).backups ?? [];
      if (latest) await this.copyOffsite(join(backupsFolder(), latest.file));
    });
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async cli(args: string[], failure: string) {
    const result = (lines: string[]) => {
      const last = lines.filter((line) => line.startsWith('{"ok":')).at(-1);
      return last ? (JSON.parse(last) as CliResult) : null;
    };
    try {
      const output = await runScript(join(paths.api(), 'dist', 'backup', 'cli.js'), args, {
        env: { ...baseEnv(this.databaseUrl()), UPLOADS_DIR: paths.uploads() },
        log: this.log,
        failure
      });
      const parsed = result(output);
      if (!parsed) throw new Error(`${failure}: no result`);
      return parsed;
    } catch (error) {
      // The tool's own last line explains a failure better than its exit code.
      const reason = result((error as { output?: string[] }).output ?? [])?.error;
      throw reason ? new Error(reason) : error;
    }
  }

  /** Once a day, and always before an update's migrations run. Called at start and hourly. */
  daily(options: { beforeUpdate?: boolean } = {}) {
    const latest = latestMigration();
    return this.serial(() =>
      this.cli(
        [
          'backup',
          '--dir',
          backupsFolder(),
          '--uploads',
          paths.uploads(),
          '--days',
          String(this.days()),
          '--reason',
          'daily',
          '--skip-if-today',
          ...(options.beforeUpdate && latest ? ['--before-update', latest] : [])
        ],
        'The daily backup failed'
      ).then((result) => this.withCopy(result))
    );
  }

  create(reason: 'manual' | 'before-restore' | 'before-move') {
    return this.serial(() =>
      this.cli(
        ['backup', '--dir', backupsFolder(), '--uploads', paths.uploads(), '--days', String(this.days()), '--reason', reason],
        'The backup failed'
      ).then((result) => this.withCopy(result))
    );
  }

  async list() {
    return (await this.serial(() => this.cli(['list', '--dir', backupsFolder()], 'Listing backups failed'))).backups ?? [];
  }

  /** After the number of days changed: both folders keep only that many. */
  prune() {
    return this.serial(async () => {
      await this.cli(['prune', '--dir', backupsFolder(), '--days', String(this.days())], 'Removing old backups failed');
      const folder = this.copies.folder();
      if (folder && existsSync(folder)) {
        await this.cli(['prune', '--dir', folder, '--days', String(this.days())], 'Removing old copies failed').catch(() => undefined);
      }
    });
  }

  /**
   * First launch on a new computer: the business from a backup file the person picked (a
   * path from the system's file dialog, never from the page). The database is empty, so
   * there is nothing to back up first.
   */
  restoreFile(path: string, hooks: { stopApi: () => Promise<void>; startApi: () => Promise<void> }) {
    return this.serial(async () => {
      await hooks.stopApi();
      try {
        await this.cli(['restore', '--file', path, '--uploads', paths.uploads()], 'The restore failed');
      } finally {
        await hooks.startApi();
      }
    });
  }

  /**
   * Replaces the business with a backup's copy. `stopApi` and `startApi` take the API
   * down around it; the current data is backed up first so a restore can be undone.
   */
  restore(file: string, hooks: { stopApi: () => Promise<void>; startApi: () => Promise<void> }) {
    return this.serial(async () => {
      // Only a backup from the list, by name: never a path from the page.
      const name = basename(file);
      const known = (await this.cli(['list', '--dir', backupsFolder()], 'Listing backups failed')).backups ?? [];
      if (name !== file || !known.some((backup) => backup.file === name)) {
        throw new Error('That backup no longer exists');
      }
      await this.cli(
        ['backup', '--dir', backupsFolder(), '--uploads', paths.uploads(), '--days', String(this.days()), '--reason', 'before-restore'],
        'Backing up the current data failed, so nothing was restored'
      );
      await hooks.stopApi();
      try {
        await this.cli(['restore', '--file', join(backupsFolder(), name), '--uploads', paths.uploads()], 'The restore failed');
      } finally {
        // Restored or not (a failed restore changes nothing), the shop needs its API back.
        await hooks.startApi();
      }
    });
  }
}
