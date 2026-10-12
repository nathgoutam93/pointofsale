import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma.service';
import { hashPassword, newPasswordFields, verifyPassword } from './password';

/** No 0/O, 1/I/L: the code is written down and typed back by hand. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 16 characters (about 79 bits) in four groups: K7Q2-MXRB-9D4F-TZ3A. */
function newRecoveryCode() {
  const chars = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

/** What the person typed, compared without spaces, dashes or case. */
const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Offline installs have no one above the admin to reset a forgotten password, so the owner
 * gets a recovery code at setup (and can replace it in Settings). Only its hash is kept.
 * Recovering with it resets one admin's password and replaces the code.
 */
@Injectable()
export class RecoveryService {
  constructor(private readonly prisma: PrismaService) {}

  /** A new code for the business (the old one stops working); returned once, in plain text. */
  async replaceCode(tx?: Prisma.TransactionClient) {
    const code = newRecoveryCode();
    await (tx ?? this.prisma).businessSettings.update({
      where: { id: 'default' },
      data: { recoveryCodeHash: await hashPassword(normalize(code)), recoveryCodeCreatedAt: new Date() }
    });
    return code;
  }

  async status() {
    const settings = await this.prisma.businessSettings.findUnique({
      where: { id: 'default' },
      select: { recoveryCodeHash: true, recoveryCodeCreatedAt: true }
    });
    return {
      set: Boolean(settings?.recoveryCodeHash),
      createdAt: settings?.recoveryCodeHash ? settings.recoveryCodeCreatedAt?.toISOString() ?? null : null
    };
  }

  /** Resets an admin's password with the recovery code; answers the replacement code. */
  async recover(input: { recoveryCode: string; username: string; newPassword: string }) {
    const settings = await this.prisma.businessSettings.findUnique({ where: { id: 'default' }, select: { recoveryCodeHash: true } });
    const valid = settings?.recoveryCodeHash ? await verifyPassword(normalize(input.recoveryCode), settings.recoveryCodeHash) : false;
    // Same answer for a wrong code and a wrong username, so neither can be guessed apart.
    const refused = new BadRequestException('That recovery code and admin username don\'t match');
    if (!valid) throw refused;
    const user = await this.prisma.user.findUnique({ where: { username: input.username }, select: { id: true, role: true } });
    if (!user || user.role !== UserRole.ADMIN) throw refused;

    const passwordHash = await hashPassword(input.newPassword);
    return this.prisma.$transaction(async (tx) => {
      // An admin locked out may also have been deactivated by mistake; recovery restores both.
      await tx.user.update({ where: { id: user.id }, data: { ...newPasswordFields(passwordHash, false), isActive: true } });
      return { recoveryCode: await this.replaceCode(tx) };
    });
  }
}
