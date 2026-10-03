import { ForbiddenException } from '@nestjs/common';
import { PLAN_LIMIT_REACHED, planByCode, TRIAL_PLAN } from '@pos/contracts';
import type { Prisma } from '@prisma/client';
import { lockBusiness } from '../common/locks';
import { currentBusiness } from '../tenancy/tenant-context';
import { billingEnforced } from './gateways';

const PLURALS = { branch: 'branches', counter: 'counters' } as const;
const howMany = (count: number, kind: 'branch' | 'counter') => `${count} ${count === 1 ? kind : PLURALS[kind]}`;

/**
 * Managed hosting: the business's plan caps its branches and active counters. Call inside the
 * transaction that adds one (a new branch brings its first counter, so it needs room for both);
 * the lock stops two requests from both seeing room. Branches and counters already over a
 * smaller plan's limits keep working; only adding more is refused.
 */
export async function assertPlanRoomFor(tx: Prisma.TransactionClient, kind: 'branch' | 'counter') {
  if (!billingEnforced()) return;
  const billing = currentBusiness()?.billing;
  if (!billing) return;
  const plan = planByCode(billing.plan) ?? planByCode(TRIAL_PLAN)!;
  await lockBusiness(tx, 'plan-limits');
  const refuse = (allows: string) =>
    new ForbiddenException({
      statusCode: 403,
      code: PLAN_LIMIT_REACHED,
      message: `The ${plan.name} plan allows ${allows}. An admin can choose a bigger plan under Settings → Billing.`
    });
  if (kind === 'branch' && (await tx.branch.count()) >= plan.branches) {
    throw refuse(howMany(plan.branches, 'branch'));
  }
  if ((await tx.counter.count({ where: { isActive: true } })) >= plan.counters) {
    throw refuse(howMany(plan.counters, 'counter'));
  }
}
