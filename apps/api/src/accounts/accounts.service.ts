import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hashPassword, verifyPassword } from '../auth/password';
import { verifyAccountToken } from '../auth/token';
import { TenancyService } from '../tenancy/tenancy.service';

/** Business owners' accounts on the hosted server (email and password, in the control schema). */
@Injectable()
export class AccountsService {
  constructor(private readonly tenancy: TenancyService) {}

  /** The account for `email`, created on first use; an existing one needs its password. */
  async findOrCreate(email: string, password: string) {
    const control = this.tenancy.control;
    const existing = await control.account.findUnique({ where: { email } });
    if (existing) {
      if (!(await verifyPassword(password, existing.passwordHash))) {
        throw new BadRequestException('This email already has an account; enter its password');
      }
      return existing;
    }
    return control.account.create({ data: { email, passwordHash: await hashPassword(password) } });
  }

  async login(email: string, password: string) {
    const account = await this.tenancy.control.account.findUnique({ where: { email } });
    if (!account || !(await verifyPassword(password, account.passwordHash))) {
      throw new BadRequestException('Invalid email or password');
    }
    return account;
  }

  /** The account behind an owner token, or 401. */
  accountIdFrom(token: string | null) {
    const accountId = token ? verifyAccountToken(token) : null;
    if (!accountId) throw new UnauthorizedException('Sign in with your owner account');
    return accountId;
  }

  async businessesOf(accountId: string) {
    const memberships = await this.tenancy.control.membership.findMany({
      where: { accountId },
      orderBy: { createdAt: 'asc' },
      select: { business: { select: { id: true, code: true, name: true, status: true } } }
    });
    return memberships.map((membership) => membership.business);
  }
}
