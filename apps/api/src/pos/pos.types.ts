import { PaymentMode, UserRole } from '@prisma/client';

export type SessionUser = {
  userId: string;
  branchId?: string;
  registerId?: string;
  role: UserRole;
};

export type PaymentInput = {
  mode: PaymentMode;
  amount: number;
  reference?: string;
};
