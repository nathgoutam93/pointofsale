import { spawn } from 'child_process';
import { createRequire } from 'module';
import { readdirSync } from 'fs';
import { join } from 'path';
import { apiRoot } from './database-urls';

/** The newest business-data migration this version ships. */
export function latestBusinessMigration() {
  return readdirSync(join(apiRoot(), 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1) ?? null;
}

/**
 * `prisma migrate deploy` for one schema file against one database URL. Business schemas use
 * prisma/schema.prisma; the control schema uses prisma/control/schema.prisma.
 */
export function migrateDeploy(schemaFile: string, env: Record<string, string>) {
  const prismaCli = createRequire(join(apiRoot(), 'package.json')).resolve('prisma/build/index.js');
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schemaFile], {
      cwd: apiRoot(),
      env: { ...process.env, ...env, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Migration failed: ${output.trim().split('\n').slice(-6).join(' ')}`))
    );
  });
}

export const businessSchemaFile = () => join(apiRoot(), 'prisma', 'schema.prisma');
export const controlSchemaFile = () => join(apiRoot(), 'prisma', 'control', 'schema.prisma');
