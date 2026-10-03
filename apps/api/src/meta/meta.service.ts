import { Injectable } from '@nestjs/common';
import { APP_VERSION } from '@pos/contracts';
import { PrismaService } from '../prisma.service';
import { isOffline, minClientVersion, posMode } from '../common/mode';

@Injectable()
export class MetaService {
  constructor(private readonly prisma: PrismaService) {}

  /** The last migration applied to this database (names start with their timestamp). */
  async schemaVersion() {
    const rows = await this.prisma.$queryRaw<Array<{ name: string }>>`
      SELECT migration_name AS name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name DESC LIMIT 1`;
    return rows[0]?.name ?? null;
  }

  /** ACTIVE when there is no row yet. */
  async instanceStatus() {
    const instance = await this.prisma.localInstance.findUnique({ where: { id: 'local' }, select: { status: true } });
    return instance?.status ?? 'ACTIVE';
  }

  async getMeta() {
    const offline = isOffline();
    return {
      appVersion: APP_VERSION,
      schemaVersion: await this.schemaVersion(),
      mode: posMode(),
      minClientVersion: minClientVersion(),
      setupRequired: offline ? (await this.prisma.user.count()) === 0 : false,
      instanceStatus: offline ? await this.instanceStatus() : null
    };
  }
}
