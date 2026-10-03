// Collects what the packaged app runs into apps/desktop/stage/, for electron-builder:
//   stage/api       the API with only its production dependencies and a generated Prisma client
//   stage/web       the built web app
//   stage/postgres  PostgreSQL binaries for this platform (bin/, lib/, share/)
// Installers are built per platform (Prisma's engines and Postgres are native), so run this
// on each target OS, as the release workflow does.
import { execSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(desktop, '..', '..');
const stage = join(desktop, 'stage');
const run = (command, cwd = repo) => execSync(command, { cwd, stdio: 'inherit' });

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

console.log('Building the shared packages, API and web app');
// The API's types come from its generated Prisma clients, which a fresh checkout doesn't have.
run('pnpm --filter @pos/api prisma:generate');
run('pnpm --filter @pos/types --filter @pos/contracts --filter @pos/api --filter @pos/web build');

console.log('Copying the API with its production dependencies');
// A flat node_modules: no symlinks, which installers (Windows above all) handle badly.
run(`pnpm --filter @pos/api deploy --prod --config.node-linker=hoisted "${join(stage, 'api')}"`);
run('node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma', join(stage, 'api'));
// The hosted server's control schema; offline installs never connect to it, but the API loads its client.
run('node node_modules/prisma/build/index.js generate --schema prisma/control/schema.prisma', join(stage, 'api'));

console.log('Copying the web app');
cpSync(join(repo, 'apps', 'web', 'dist'), join(stage, 'web'), { recursive: true });

console.log('Copying PostgreSQL');
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const binaries = await import(`@embedded-postgres/${platform}-${process.arch}`);
const postgresHome = dirname(dirname(binaries.postgres));
// Resolve symlinks (shared libraries link to their versioned names) into real files.
cpSync(postgresHome, join(stage, 'postgres'), { recursive: true, dereference: true });

for (const required of ['api/dist/main.js', 'api/node_modules/.prisma/client', 'api/node_modules/.prisma/control-client', 'web/index.html', 'postgres/bin']) {
  if (!existsSync(join(stage, required))) throw new Error(`Staging is missing ${required}`);
}
console.log(`Staged in ${stage}`);
