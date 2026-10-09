import { HttpException } from '@nestjs/common';

/**
 * Counts failed attempts per key (e.g. address + business code + username) in memory, and
 * refuses further attempts for a while once there are too many. A success clears the count.
 * Per process: with several API processes, put a shared limiter (or the load balancer's) in
 * front as well.
 */
export class FailureLimiter {
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number
  ) {}

  assertAllowed(key: string) {
    const entry = this.failures.get(key);
    if (!entry) return;
    if (entry.until < Date.now()) {
      this.failures.delete(key);
      return;
    }
    if (entry.count >= this.maxFailures) {
      throw new HttpException('Too many failed attempts. Wait a few minutes and try again.', 429);
    }
  }

  failed(key: string) {
    const entry = this.failures.get(key);
    if (entry && entry.until >= Date.now()) entry.count += 1;
    else this.failures.set(key, { count: 1, until: Date.now() + this.windowMs });
    if (this.failures.size > 10_000) {
      const now = Date.now();
      for (const [k, v] of this.failures) if (v.until < now) this.failures.delete(k);
    }
  }

  succeeded(key: string) {
    this.failures.delete(key);
  }
}
