import { app } from 'electron';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
/** apps/ in the repo, when running unpackaged (`pnpm --filter @pos/desktop start`). */
const appsDir = join(here, '..', '..');

/**
 * Where everything the app needs lives. Packaged, the API, web app and Postgres binaries sit
 * in the resources folder (outside app.asar, so the binaries can run). Unpackaged, they come
 * from the repo: run `pnpm build` first so apps/api/dist and apps/web/dist exist.
 */
export const paths = {
  web: () => (app.isPackaged ? join(process.resourcesPath, 'web') : join(appsDir, 'web', 'dist')),
  api: () => (app.isPackaged ? join(process.resourcesPath, 'api') : join(appsDir, 'api')),
  /** Holds bin/, lib/ and share/ of the bundled PostgreSQL. */
  postgresHome: async () => {
    if (app.isPackaged) return join(process.resourcesPath, 'postgres');
    const platform = process.platform === 'win32' ? 'windows' : process.platform;
    const binaries = (await import(`@embedded-postgres/${platform}-${process.arch}`)) as { postgres: string };
    return dirname(dirname(binaries.postgres));
  },
  preload: () => join(here, 'preload.cjs'),
  userData: () => app.getPath('userData'),
  config: () => join(app.getPath('userData'), 'config.json'),
  database: () => join(app.getPath('userData'), 'pgdata'),
  uploads: () => join(app.getPath('userData'), 'uploads'),
  logs: () => join(app.getPath('userData'), 'logs')
};
