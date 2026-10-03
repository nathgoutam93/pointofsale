// Hosted server maintenance:
//   node dist/tenancy/cli.js migrate [--concurrency N]
//     At every deploy, before the new API starts: brings the control schema and every
//     business's schema to this version's migrations.
//   node dist/tenancy/cli.js create --name "Shop name" --admin <username> --password <password> [--code CODE]
//     Creates a business (for local development, or before sign-up is open).
import './../load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { migrateAllBusinesses } from './migrate-all';
import { ProvisioningService } from './provisioning.service';

function option(args: string[], name: string) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

async function migrate(args: string[]) {
  const concurrency = option(args, 'concurrency');
  const result = await migrateAllBusinesses({
    concurrency: concurrency ? Number(concurrency) : undefined,
    log: (line) => process.stdout.write(`${line}\n`)
  });
  process.stdout.write(
    `${result.results.filter((r) => r.ok).length} businesses at ${result.latest}` +
      (result.ok ? '\n' : `; stopped after a failure, ${result.skipped} not tried\n`)
  );
  return result.ok;
}

async function create(args: string[]) {
  const name = option(args, 'name');
  const adminUsername = option(args, 'admin');
  const adminPassword = option(args, 'password');
  if (!name || !adminUsername || !adminPassword) throw new Error('--name, --admin and --password are required');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const { business } = await app.get(ProvisioningService).createBusiness(
      { businessName: name, adminUsername, adminPassword, timezone: 'Asia/Kolkata', taxpayerType: 'REGULAR', branchCode: 'MAI' },
      { code: option(args, 'code')?.toUpperCase() }
    );
    process.stdout.write(`Created "${business.name}". Business code: ${business.code}\n`);
    return true;
  } finally {
    await app.close();
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'migrate') return migrate(args);
  if (command === 'create') return create(args);
  throw new Error(`Unknown command: ${command ?? '(none)'}; use "migrate" or "create"`);
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
);
