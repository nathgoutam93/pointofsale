import { existsSync } from 'fs';
import { join } from 'path';

// Imported first by main.ts: some settings (UPLOADS_DIR) are read while modules load.
const envFile = join(process.cwd(), '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
