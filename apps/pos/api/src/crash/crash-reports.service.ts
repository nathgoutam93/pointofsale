import { Injectable, Logger } from '@nestjs/common';
import { APP_VERSION, crashDetails, scrubCrashText, type CrashReport } from '@pos/contracts';
import { createHash } from 'crypto';
import { release, type } from 'os';
import { isOffline } from '../common/mode';
import { currentBusiness } from '../tenancy/tenant-context';
import { TenancyService } from '../tenancy/tenancy.service';

/** How long reports are kept. */
const KEEP_DAYS = 90;

/** The message and the top frame, without line numbers that change between builds. */
function fingerprint(source: string, message: string, stack: string) {
  const top = stack.split('\n')[0]?.replace(/:\d+:\d+\)?$/, '') ?? '';
  return createHash('sha256').update(`${source}\n${message.replace(/\d+/g, '#')}\n${top}`).digest('hex').slice(0, 16);
}

/**
 * Crash reports on the online server (control schema): from apps (POST /crash-reports) and from
 * this server's own unexpected errors. Everything is scrubbed again here, whatever the sender did.
 */
@Injectable()
export class CrashReportsService {
  private readonly logger = new Logger('CrashReports');

  constructor(private readonly tenancy: TenancyService) {}

  async record(reports: CrashReport[], businessId: string | null) {
    const control = this.tenancy.control;
    await control.crashReport.createMany({
      data: reports.map((report) => {
        const message = scrubCrashText(report.message).slice(0, 500);
        const stack = scrubCrashText(report.stack).slice(0, 8000);
        return {
          source: report.source,
          appVersion: report.appVersion,
          mode: report.mode,
          os: scrubCrashText(report.os).slice(0, 80),
          message,
          stack,
          fingerprint: fingerprint(report.source, message, stack),
          installId: report.installId ?? null,
          businessId,
          occurredAt: new Date(report.occurredAt)
        };
      })
    });
    await control.crashReport.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000) } } });
  }

  /** An unexpected error while answering a request on this server (online only). Never throws. */
  recordServerError(error: unknown) {
    if (isOffline()) return;
    const { message, stack } = crashDetails(error);
    const data = {
      source: 'server',
      appVersion: APP_VERSION,
      mode: 'server',
      os: `${type()} ${release()}`.slice(0, 80),
      message,
      stack,
      fingerprint: fingerprint('server', message, stack),
      businessId: currentBusiness()?.id ?? null,
      occurredAt: new Date()
    };
    void this.tenancy.control.crashReport.create({ data }).catch((failure: unknown) => this.logger.warn(`Couldn't keep a crash report: ${String(failure)}`));
  }

  /** The last `days` days' reports, grouped by crash: most frequent first. */
  async summary(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const groups = await this.tenancy.control.crashReport.groupBy({
      by: ['fingerprint'],
      where: { receivedAt: { gte: since } },
      _count: { _all: true },
      _max: { receivedAt: true },
      orderBy: { _count: { fingerprint: 'desc' } }
    });
    const result = [];
    for (const group of groups) {
      const latest = await this.tenancy.control.crashReport.findFirstOrThrow({ where: { fingerprint: group.fingerprint }, orderBy: { receivedAt: 'desc' } });
      const spread = await this.tenancy.control.crashReport.findMany({
        where: { fingerprint: group.fingerprint, receivedAt: { gte: since } },
        select: { appVersion: true, mode: true, installId: true, businessId: true },
        distinct: ['appVersion', 'mode', 'installId', 'businessId']
      });
      result.push({
        count: group._count._all,
        lastSeen: group._max.receivedAt,
        source: latest.source,
        message: latest.message,
        stack: latest.stack,
        versions: [...new Set(spread.map((row) => row.appVersion))],
        modes: [...new Set(spread.map((row) => row.mode))],
        computers: new Set(spread.map((row) => row.installId).filter(Boolean)).size,
        businesses: new Set(spread.map((row) => row.businessId).filter(Boolean)).size
      });
    }
    return result;
  }
}
