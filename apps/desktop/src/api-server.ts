import { utilityProcess, type UtilityProcess } from 'electron';
import { spawn } from 'child_process';
import { readdirSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';
import type { Logger } from './log.js';
import { paths } from './paths.js';

type ApiEnv = { databaseUrl: string; authSecret: string; corsOrigin: string };

/** Collects a child's output line by line, for the log and for messages it prints. */
function forwardLines(stream: NodeJS.ReadableStream | null | undefined, onLine: (line: string) => void) {
  let buffer = '';
  stream?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(onLine);
  });
}

/** Settings shared by the API and the scripts run next to it, never the user's whole environment. */
export function baseEnv(databaseUrl: string): Record<string, string> {
  const keep = ['PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG'];
  const env: Record<string, string> = {};
  for (const key of keep) {
    if (process.env[key]) env[key] = process.env[key] as string;
  }
  return {
    ...env,
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    // Prisma must not phone home or print update notices.
    CHECKPOINT_DISABLE: '1',
    PRISMA_HIDE_UPDATE_MESSAGE: '1'
  };
}

/**
 * Runs a Node script to completion with the app's own binary acting as plain Node, and
 * returns what it printed. Not a utility process: those never exit on their own (the link
 * to the parent keeps them alive), and scripts such as Prisma's CLI rely on exiting that way.
 */
export function runScript(
  script: string,
  args: string[],
  options: { env: Record<string, string>; log: Logger; failure: string; timeoutMs?: number }
) {
  return new Promise<string[]>((resolve, reject) => {
    const output: string[] = [];
    const child = spawn(process.execPath, [script, ...args], {
      cwd: paths.api(),
      env: { ...options.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const collect = (line: string) => {
      output.push(line);
      options.log(line);
    };
    forwardLines(child.stdout, collect);
    forwardLines(child.stderr, collect);
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 10 * 60 * 1000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(Object.assign(new Error(`${options.failure} (exit ${code}): ${output.slice(-8).join(' ')}`), { output }));
    });
  });
}

/** The newest migration this version ships; the database is brought up to it on every start. */
export function latestMigration() {
  return readdirSync(join(paths.api(), 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1);
}

/**
 * Brings the local database up to the schema this app version ships with. Runs on every
 * launch; after an update it applies the new migrations, otherwise it does nothing.
 */
export async function runMigrations(databaseUrl: string, log: Logger) {
  const apiDir = paths.api();
  const prismaCli = createRequire(join(apiDir, 'package.json')).resolve('prisma/build/index.js');
  await runScript(prismaCli, ['migrate', 'deploy', '--schema', join(apiDir, 'prisma', 'schema.prisma')], {
    env: baseEnv(databaseUrl),
    log,
    failure: 'Updating the database failed'
  });
}

/** The API (apps/api) running in the background in offline mode, on this machine only. */
export class LocalApi {
  private child?: UtilityProcess;
  private stopping = false;
  port = 0;

  constructor(
    private readonly log: Logger,
    /** Called if the API exits while the app is still using it. */
    private readonly onCrash: (detail: string) => void
  ) {}

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  start({ databaseUrl, authSecret, corsOrigin }: ApiEnv) {
    const apiDir = paths.api();
    const recent: string[] = [];
    return new Promise<void>((resolve, reject) => {
      let started = false;
      const child = utilityProcess.fork(join(apiDir, 'dist', 'main.js'), [], {
        // Not the API folder: in development it may hold a .env meant for `pnpm dev`.
        cwd: paths.userData(),
        env: {
          ...baseEnv(databaseUrl),
          POS_MODE: 'offline',
          HOST: '127.0.0.1',
          PORT: '0',
          AUTH_SECRET: authSecret,
          UPLOADS_DIR: paths.uploads(),
          CORS_ORIGINS: corsOrigin
        },
        stdio: 'pipe',
        serviceName: 'POS API'
      });
      this.child = child;
      const timer = setTimeout(() => {
        if (!started) {
          child.kill();
          reject(new Error(`The API didn't start within 60 seconds: ${recent.join(' ')}`));
        }
      }, 60_000);

      const onLine = (line: string) => {
        this.log(line);
        recent.push(line);
        if (recent.length > 8) recent.shift();
        if (!started && line.startsWith('{"event":"listening"')) {
          const message = JSON.parse(line) as { port: number };
          this.port = message.port;
          started = true;
          clearTimeout(timer);
          resolve();
        }
      };
      forwardLines(child.stdout, onLine);
      forwardLines(child.stderr, onLine);

      child.on('exit', (code) => {
        clearTimeout(timer);
        this.child = undefined;
        const detail = `The API stopped (exit ${code}): ${recent.join(' ')}`;
        if (!started) reject(new Error(detail));
        else if (!this.stopping) this.onCrash(detail);
      });
    });
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }
}
