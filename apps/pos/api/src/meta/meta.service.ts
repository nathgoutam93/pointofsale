import { Injectable } from '@nestjs/common';
import { APP_VERSION } from '@pos/contracts';
import { PrismaService } from '../prisma.service';
import { isOffline, minClientVersion, posHosting, posMode } from '../common/mode';
import { latestBusinessMigration } from '../tenancy/migrator';

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

  /** Once moved online: where to sign in now. */
  async movedTo() {
    const instance = await this.prisma.localInstance.findUnique({
      where: { id: 'local' },
      select: { status: true, movedToBusinessCode: true, movedToServer: true }
    });
    return instance?.status === 'ARCHIVED' && instance.movedToBusinessCode && instance.movedToServer
      ? { businessCode: instance.movedToBusinessCode, server: instance.movedToServer }
      : null;
  }

  async getMeta() {
    const offline = isOffline();
    return {
      appVersion: APP_VERSION,
      // Online there is no one database to ask: every business is kept at the version this
      // server ships (see the migration runner), which is what an offline business must match.
      schemaVersion: offline ? await this.schemaVersion() : latestBusinessMigration(),
      mode: posMode(),
      hosting: posHosting(),
      minClientVersion: minClientVersion(),
      setupRequired: offline ? (await this.prisma.user.count()) === 0 : false,
      instanceStatus: offline ? await this.instanceStatus() : null,
      movedTo: offline ? await this.movedTo() : null
    };
  }
}
