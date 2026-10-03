import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { createReadStream } from 'fs';
import { rm } from 'fs/promises';
import { Public } from '../auth/auth.guard';
import { OnlineOnlyGuard } from '../common/mode';
import { requireAdminSession, type RequestHeaders } from '../common/request-session';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { FallbackService, type FallbackOutbox } from './fallback.service';

/** The header a fallback counter's computer sends its key in. */
export const FALLBACK_KEY_HEADER = 'x-pos-fallback-key';

const keyOf = (headers: RequestHeaders) => {
  const value = headers[FALLBACK_KEY_HEADER];
  return typeof value === 'string' ? value : undefined;
};

/** Online server: setting up a fallback counter, its local copy, and taking its offline sales. */
@Controller()
@UseGuards(OnlineOnlyGuard)
export class FallbackController {
  constructor(private readonly fallback: FallbackService) {}

  @Post('/counters/:id/fallback')
  @HttpCode(200)
  designate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(appContract.counters.setFallback.body)) body: { deviceId: string },
    @Headers() headers: RequestHeaders
  ) {
    return this.fallback.designate(requireAdminSession(headers), id, body.deviceId);
  }

  @Delete('/counters/:id/fallback')
  release(@Param('id', ParseUUIDPipe) id: string, @Headers() headers: RequestHeaders) {
    return this.fallback.release(requireAdminSession(headers), id);
  }

  /** The counter's computer, with its key: its local copy (a zip in the local backup format). */
  @Public()
  @Get('/fallback/snapshot')
  async snapshot(
    @Headers() headers: RequestHeaders,
    @Res() res: { setHeader(name: string, value: string): void; on(event: string, listener: () => void): void } & NodeJS.WritableStream
  ) {
    const counter = await this.fallback.authenticate(keyOf(headers));
    const { file, dir } = await this.fallback.snapshot(counter);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="fallback-copy.zip"');
    res.on('close', () => void rm(dir, { recursive: true, force: true }));
    createReadStream(file).pipe(res);
  }

  /** The counter's computer, with its key: what it made while offline. */
  @Public()
  @Post('/fallback/sync')
  @HttpCode(200)
  async sync(@Headers() headers: RequestHeaders, @Body() body: unknown) {
    const counter = await this.fallback.authenticate(keyOf(headers));
    return this.fallback.sync(counter, parseOutbox(body));
  }
}

/** The outbox's shape; rows inside are checked against the counter by the service. */
function parseOutbox(body: unknown): FallbackOutbox {
  const value = (body ?? {}) as Partial<FallbackOutbox>;
  const rowList = (list: unknown) => Array.isArray(list) && list.every((row) => row && typeof row === 'object' && !Array.isArray(row));
  const ok =
    typeof value.schemaVersion === 'string' &&
    rowList(value.registers) &&
    Array.isArray(value.invoices) &&
    value.invoices.every(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        entry.invoice &&
        typeof entry.invoice === 'object' &&
        ['lines', 'discounts', 'allocations', 'payments', 'receipts', 'ledger'].every((key) => rowList((entry as Record<string, unknown>)[key]))
    ) &&
    Array.isArray(value.sequences) &&
    value.sequences.every(
      (sequence) =>
        sequence && typeof sequence.kind === 'string' && typeof sequence.series === 'string' && Number.isInteger(sequence.fiscalYear) && Number.isInteger(sequence.lastSeq)
    ) &&
    Number.isInteger(value.receiptSeq);
  if (!ok) throw new BadRequestException('Not a fallback outbox');
  return value as FallbackOutbox;
}
