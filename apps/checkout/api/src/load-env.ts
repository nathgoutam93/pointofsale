import { existsSync } from 'fs';
import { join } from 'path';

// Imported first by main.ts: the service's settings come from .env in its folder, when there is
// one (on the server, systemd's EnvironmentFile sets them instead).
const envFile = join(process.cwd(), '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
