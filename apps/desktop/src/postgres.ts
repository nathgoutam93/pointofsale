import { execFile } from 'child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { join } from 'path';
import { promisify } from 'util';
import type { Logger } from './log.js';
import { paths } from './paths.js';

const run = promisify(execFile);

/** A port nothing is listening on right now. */
export function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No free port'))));
    });
  });
}

/**
 * The PostgreSQL server bundled with the app, holding an offline business. Data lives in
 * userData/pgdata. pg_ctl starts and stops it on every platform: it waits until the server
 * accepts connections, stops it cleanly, and on Windows drops administrator rights, which
 * PostgreSQL refuses to run with.
 */
export class LocalPostgres {
  port = 0;

  constructor(
    private readonly home: string,
    private readonly password: string,
    private readonly log: Logger
  ) {}

  private bin(name: string) {
    return join(this.home, 'bin', process.platform === 'win32' ? `${name}.exe` : name);
  }

  private async pgCtl(args: string[], timeoutMs = 120_000) {
    const { stdout, stderr } = await run(this.bin('pg_ctl'), args, { timeout: timeoutMs, windowsHide: true });
    this.log([stdout, stderr].filter(Boolean).join('\n'));
  }

  get databaseUrl() {
    return `postgresql://postgres:${encodeURIComponent(this.password)}@127.0.0.1:${this.port}/postgres?schema=public`;
  }

  /** Creates the data folder on first run. A failed attempt leaves nothing behind. */
  private async ensureInitialised() {
    const dataDir = paths.database();
    if (existsSync(join(dataDir, 'PG_VERSION'))) return;
    const staging = `${dataDir}.init`;
    const passwordFile = join(paths.userData(), 'pg-password.tmp');
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(paths.userData(), { recursive: true });
    writeFileSync(passwordFile, `${this.password}\n`, { mode: 0o600 });
    try {
      this.log('Creating the database (first run)');
      const { stdout, stderr } = await run(
        this.bin('initdb'),
        [`--pgdata=${staging}`, '--username=postgres', '--auth=scram-sha-256', `--pwfile=${passwordFile}`, '--encoding=UTF8', '--no-locale'],
        { timeout: 300_000, windowsHide: true }
      );
      this.log([stdout, stderr].filter(Boolean).join('\n'));
      renameSync(staging, dataDir);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw new Error(`Couldn't create the database: ${describe(error)}`);
    } finally {
      rmSync(passwordFile, { force: true });
    }
  }

  async start() {
    await this.ensureInitialised();
    const dataDir = paths.database();
    // A server left running by a crashed session holds the data folder; stop it first.
    if (existsSync(join(dataDir, 'postmaster.pid'))) {
      await this.pgCtl(['stop', '-D', dataDir, '-m', 'fast', '-w']).catch((error) =>
        this.log(`No earlier server to stop: ${describe(error)}`)
      );
    }
    this.port = await freePort();
    mkdirSync(paths.logs(), { recursive: true });
    try {
      await this.pgCtl([
        'start',
        '-D',
        dataDir,
        '-l',
        join(paths.logs(), 'postgres.log'),
        '-w',
        '-t',
        '120',
        '-o',
        `-p ${this.port} -c listen_addresses=127.0.0.1`
      ]);
    } catch (error) {
      throw new Error(`The database didn't start: ${describe(error)}. See postgres.log in the logs folder.`);
    }
    this.log(`Database listening on 127.0.0.1:${this.port}`);
  }

  async stop() {
    if (!this.port) return;
    try {
      await this.pgCtl(['stop', '-D', paths.database(), '-m', 'fast', '-w'], 60_000);
    } catch (error) {
      this.log(`Stopping the database failed: ${describe(error)}`);
    }
    this.port = 0;
  }
}

export function describe(error: unknown) {
  if (error && typeof error === 'object') {
    const { stderr, message } = error as { stderr?: string; message?: string };
    return (stderr?.trim() || message || String(error)).slice(0, 2000);
  }
  return String(error);
}
