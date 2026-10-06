import { ConflictException, Injectable } from '@nestjs/common';
import { CompositionCategory, TaxpayerType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import { CustomersService } from '../customers/customers.service';
import { DEFAULT_COUNTER_NAME } from '../common/counters';
import { lockBusiness } from '../common/locks';
import { localDate } from '../reports/zoned-dates';
import { isOffline } from '../common/mode';
import { RecoveryService } from '../auth/recovery.service';

export type SetupInput = {
  businessName: string;
  gstNumber?: string | null;
  stateCode?: string | null;
  timezone: string;
  taxpayerType: TaxpayerType;
  compositionCategory?: CompositionCategory | null;
  branchCode: string;
  adminUsername: string;
  adminPassword: string;
};

const formatDate = (date: { year: number; month: number; day: number }) =>
  `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

/**
 * First run of an offline install: the business, its one branch and counter, and the first
 * admin, all from what the owner typed. Replaces the startup seed (and its printed password).
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly customers: CustomersService,
    private readonly recovery: RecoveryService
  ) {}

  async setup(input: SetupInput) {
    const passwordHash = await hashPassword(input.adminPassword);
    let recoveryCode: string | null = null;
    const branch = await this.prisma.$transaction(async (tx) => {
      // Two setup requests at once: the second waits here, then finds the first one's admin.
      await lockBusiness(tx, 'setup');
      const [users, branches] = await Promise.all([tx.user.count(), tx.branch.count()]);
      if (users > 0) {
        throw new ConflictException('This business is already set up; sign in instead');
      }
      if (branches > 0) {
        throw new ConflictException('This database already holds business data; setup only runs on an empty one');
      }

      await tx.businessSettings.upsert({
        where: { id: 'default' },
        update: { name: input.businessName, gstNumber: input.gstNumber ?? null, timezone: input.timezone },
        create: { id: 'default', name: input.businessName, gstNumber: input.gstNumber ?? null, timezone: input.timezone }
      });
      const created = await tx.branch.create({
        data: {
          name: input.businessName,
          code: input.branchCode,
          stateCode: input.gstNumber ? input.gstNumber.slice(0, 2) : input.stateCode ?? null
        },
        select: { id: true }
      });
      await tx.counter.create({ data: { branchId: created.id, number: 1, name: DEFAULT_COUNTER_NAME } });
      const admin = await tx.user.create({
        data: { username: input.adminUsername, password: passwordHash, role: UserRole.ADMIN, branchId: created.id },
        select: { id: true, username: true }
      });
      await tx.userBranchAccess.create({ data: { userId: admin.id, branchId: created.id } });

      if (input.taxpayerType !== 'REGULAR') {
        // In force from now: the business has made no sales yet.
        await tx.taxpayerTypeChange.create({
          data: {
            taxpayerType: input.taxpayerType,
            compositionCategory: input.compositionCategory ?? null,
            effectiveDate: formatDate(localDate(new Date(), input.timezone)),
            effectiveFrom: new Date(),
            createdBy: admin.id,
            createdByName: admin.username
          }
        });
      }
      // Offline there is no one above the admin; the owner keeps this to reset a forgotten
      // password. Online businesses have their owner account instead.
      recoveryCode = isOffline() ? await this.recovery.replaceCode(tx) : null;
      return created;
    });

    await this.customers.ensureWalkInCustomer(branch.id);
    return { ...(await this.auth.login(input.adminUsername, input.adminPassword)), recoveryCode };
  }
}
