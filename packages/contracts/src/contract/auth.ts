// Server info, first-run setup and sign-up, owner accounts, sign-in and users.
import { z } from 'zod';
import {
  branchCodeSchema,
  branchSchema,
  c,
  cashierPermissionSchema,
  compositionCategorySchema,
  emailSchema,
  gstinSchema,
  gstStateCodeSchema,
  passwordSchema,
  requiredText,
  roleSchema,
  taxpayerTypeSchema,
  timeZoneSchema,
  uniqueBy
} from './shared.js';

export const userSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: roleSchema,
  branchId: z.string().uuid(),
  branchIds: z.array(z.string().uuid()),
  isActive: z.boolean(),
  /** An admin set their password; they haven't chosen their own yet. */
  mustChangePassword: z.boolean().default(false),
  /** Cashiers only: what they may do beyond selling. */
  permissions: z.array(cashierPermissionSchema).default([]),
  createdAt: z.string().datetime()
});

/** A signed-in session, as returned by sign-in and by first-run setup. */
const loginResponseSchema = z.object({
  token: z.string(),
  userId: z.string().uuid(),
  username: z.string(),
  role: roleSchema,
  branchId: z.string().uuid().nullable(),
  registerId: z.string().uuid().nullable(),
  /** The counter of the open register, if any. */
  counterId: z.string().uuid().nullable(),
  counterName: z.string().nullable(),
  branches: z.array(branchSchema),
  /** An admin set this password: the user chooses their own before doing anything else. */
  mustChangePassword: z.boolean().default(false),
  /** Cashiers: what they may do beyond selling (see hasPermission). */
  permissions: z.array(cashierPermissionSchema).default([])
});

/**
 * Web clients keep the sign-in in an httpOnly cookie (named SESSION_COOKIE), which page scripts
 * can't read. They send this header with the value "cookie" on every request: only then does the
 * API read the cookie (a form or link from another site can't add a header), and in answers it
 * sets the cookie instead of returning the token.
 */
export const SESSION_HEADER = 'x-pos-session';
export const SESSION_COOKIE = 'pos_session';

/** The `code` of the 403 a user gets until they choose a new password (see auth.changePassword). */
export const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';

/** The code emailed to an owner to reset their password: 8 digits. */
const resetCodeSchema = z.string().trim().regex(/^\d{8}$/, 'Enter the 8-digit code from the email');

/**
 * The `code` of the 400 answered when an owner's email isn't verified yet: a code was just
 * emailed to it, and the same request is sent again with `emailCode`.
 */
export const EMAIL_VERIFICATION_REQUIRED = 'EMAIL_VERIFICATION_REQUIRED';
/** The emailed verification code, when the server asked for one. */
const emailCodeSchema = z.string().trim().regex(/^\d{8}$/, 'Enter the 8-digit code from the email').optional();

/** offline: one branch and one counter, all on this machine. online: the hosted, multi-business server. */
export const posModeSchema = z.enum(['offline', 'online']);
export type PosMode = z.infer<typeof posModeSchema>;

/**
 * Online servers only. managed: our hosted service, where businesses sign up and pay a
 * subscription. self: a business's own server (any other), with no billing.
 */
export const hostingSchema = z.enum(['managed', 'self']);
export type Hosting = z.infer<typeof hostingSchema>;

/** ACTIVE: in use. MIGRATING: being moved online, writes paused. ARCHIVED: moved online, read-only. */
export const localInstanceStatusSchema = z.enum(['ACTIVE', 'MIGRATING', 'ARCHIVED']);

export const metaSchema = z.object({
  appVersion: z.string(),
  /** The last database migration applied, e.g. 20261005110000_counter_document_numbers. */
  schemaVersion: z.string().nullable(),
  mode: posModeSchema,
  /** Online only: our managed service or a self-hosted server. Missing from older servers. */
  hosting: hostingSchema.nullable().optional(),
  /** Online only: clients older than this must update before using the API. */
  minClientVersion: z.string().nullable(),
  /** Offline only: true until first-run setup has created the business and its admin. */
  setupRequired: z.boolean(),
  /** Offline only: whether this machine's business is in use, moving online, or has moved. */
  instanceStatus: localInstanceStatusSchema.nullable(),
  /** Offline, once moved: the online business to sign in to instead. */
  movedTo: z.object({ businessCode: z.string(), server: z.string() }).nullable()
});

/** Offline: the last step of moving online, once the server has imported the business. */
export const migrationCompleteBodySchema = z.object({
  businessId: z.string().uuid(),
  businessCode: z.string().min(1).max(16),
  server: z.string().url()
});

/** A new business and its first admin: first-run setup offline, sign-up online. */
const businessSetupSchema = z.object({
  businessName: requiredText.pipe(z.string().max(120)),
  gstNumber: gstinSchema.nullable().optional(),
  /** Where the shop is; taken from the GSTIN when one is given. */
  stateCode: gstStateCodeSchema.nullable().optional(),
  timezone: timeZoneSchema.default('Asia/Kolkata'),
  taxpayerType: taxpayerTypeSchema.default('REGULAR'),
  compositionCategory: compositionCategorySchema.nullable().optional(),
  /** Starts every invoice number; MAI if not given. */
  branchCode: branchCodeSchema.default('MAI'),
  adminUsername: requiredText.pipe(z.string().max(64)),
  adminPassword: passwordSchema
});

function checkBusinessSetup(
  body: { taxpayerType: string; compositionCategory?: string | null; gstNumber?: string | null; stateCode?: string | null },
  ctx: z.RefinementCtx
) {
  if ((body.taxpayerType === 'COMPOSITION') !== !!body.compositionCategory) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A composition taxpayer needs a category, and a regular one must not have one',
      path: ['compositionCategory']
    });
  }
  if (body.gstNumber && body.stateCode && body.gstNumber.slice(0, 2) !== body.stateCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The state doesn't match the GSTIN", path: ['stateCode'] });
  }
}

/** A business as its owner sees it. `code` is what staff type when signing in. */
export const ownedBusinessSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  status: z.enum(['PROVISIONING', 'ACTIVE', 'SUSPENDED', 'FAILED'])
});

export const metaRoutes = c.router({
  get: {
    method: 'GET',
    path: '/meta',
    responses: { 200: metaSchema }
  }
});

export const setupRoutes = c.router({
  /** Offline only, and only while the database has no users: creates the business and its first admin. */
  run: {
    method: 'POST',
    path: '/setup',
    body: businessSetupSchema.superRefine(checkBusinessSetup),
    responses: {
      201: loginResponseSchema.extend({
        /** Shown once: resets a forgotten admin password (see auth.recover). */
        recoveryCode: z.string().nullable()
      })
    }
  }
});

export const businessesRoutes = c.router({
  /**
   * Online only: creates a business and signs its admin in. The owner's account (email and
   * password) is created on first use; later businesses need the same password.
   */
  create: {
    method: 'POST',
    path: '/businesses',
    body: businessSetupSchema
      .extend({ ownerEmail: emailSchema, ownerPassword: passwordSchema, emailCode: emailCodeSchema })
      .superRefine(checkBusinessSetup),
    responses: {
      201: z.object({ business: ownedBusinessSchema, session: loginResponseSchema, accountToken: z.string() })
    }
  }
});

export const accountsRoutes = c.router({
  /** Online only: creates an owner account, or signs in to an existing one with its password. */
  signup: {
    method: 'POST',
    path: '/accounts/signup',
    body: z.object({ email: emailSchema, password: passwordSchema, emailCode: emailCodeSchema }),
    responses: { 200: z.object({ token: z.string(), businesses: z.array(ownedBusinessSchema) }) }
  },
  /** Online only: an owner's sign-in. The token lists and manages their businesses (not sales). */
  login: {
    method: 'POST',
    path: '/accounts/login',
    body: z.object({ email: emailSchema, password: z.string() }),
    responses: { 200: z.object({ token: z.string(), businesses: z.array(ownedBusinessSchema) }) }
  },
  businesses: {
    method: 'GET',
    path: '/accounts/businesses',
    responses: { 200: z.array(ownedBusinessSchema) }
  },
  /** Online, owner token: the staff of one of the owner's businesses. */
  staff: {
    method: 'GET',
    path: '/accounts/businesses/:businessId/staff',
    responses: {
      200: z.array(
        z.object({
          id: z.string().uuid(),
          username: z.string(),
          role: z.enum(['ADMIN', 'CASHIER']),
          /** Their home branch; admins may manage more (branchCount). */
          branchName: z.string(),
          branchCount: z.number().int(),
          isActive: z.boolean(),
          mustChangePassword: z.boolean(),
          createdAt: z.string().datetime()
        })
      )
    }
  },
  /**
   * Online, owner token: turns a staff user of one of the owner's businesses off (they are
   * signed out everywhere and can't sign in) or on again. The last active admin stays on.
   */
  staffActive: {
    method: 'POST',
    path: '/accounts/staff-active',
    body: z.object({ businessId: z.string().uuid(), username: z.string().trim().min(1), isActive: z.boolean() }),
    responses: { 200: z.object({ username: z.string(), isActive: z.boolean() }) }
  },
  /**
   * Online, owner token: a new password for a staff user of one of the owner's businesses
   * (an admin who forgot theirs). Their other sessions end; an inactive admin is reactivated.
   */
  staffPassword: {
    method: 'POST',
    path: '/accounts/staff-password',
    body: z.object({ businessId: z.string().uuid(), username: z.string().trim().min(1), newPassword: passwordSchema }),
    responses: { 200: z.object({ username: z.string() }) }
  },
  /**
   * Online, no sign-in: emails an 8-digit code to reset an owner's password. Answers the same
   * whether or not the email has an account.
   */
  requestPasswordReset: {
    method: 'POST',
    path: '/accounts/password-reset',
    body: z.object({ email: emailSchema }),
    responses: { 202: z.object({ sent: z.literal(true) }) }
  },
  /** Online, no sign-in: the emailed code and a new password. Signs the owner out everywhere. */
  confirmPasswordReset: {
    method: 'POST',
    path: '/accounts/password-reset/confirm',
    body: z.object({ email: emailSchema, code: resetCodeSchema, newPassword: passwordSchema }),
    responses: { 200: z.object({ reset: z.literal(true) }) }
  }
});

export const authRoutes = c.router({
  login: {
    method: 'POST',
    path: '/auth/login',
    body: z.object({
      /** Online (hosted) server: which business to sign in to. Not used offline. */
      businessCode: z.string().trim().toUpperCase().max(16).optional(),
      username: z.string(),
      password: z.string()
    }),
    responses: { 200: loginResponseSchema }
  },
  /**
   * Offline only, no sign-in: a forgotten admin password, reset with the business's recovery
   * code. The code is replaced; the answer is the new one, shown once.
   */
  recover: {
    method: 'POST',
    path: '/auth/recover',
    body: z.object({ recoveryCode: z.string().trim().min(1), username: z.string().trim().min(1), newPassword: passwordSchema }),
    responses: { 200: z.object({ recoveryCode: z.string() }) }
  },
  /**
   * Signed in: the user's own new password. Needed before anything else when an admin set
   * their password. Other sessions end; this one gets a new token.
   */
  changePassword: {
    method: 'POST',
    path: '/auth/change-password',
    body: z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
    responses: { 200: z.object({ token: z.string() }) }
  },
  /** Offline, admins: whether a recovery code exists, and since when. */
  recoveryCodeStatus: {
    method: 'GET',
    path: '/auth/recovery-code',
    responses: { 200: z.object({ set: z.boolean(), createdAt: z.string().datetime().nullable() }) }
  },
  /** Offline, admins: a new recovery code (the old one stops working), shown once. */
  newRecoveryCode: {
    method: 'POST',
    path: '/auth/recovery-code',
    body: z.object({}).optional(),
    responses: { 201: z.object({ recoveryCode: z.string() }) }
  },
  /** Ends this browser's sign-in: clears the session cookie. */
  logout: {
    method: 'POST',
    path: '/auth/logout',
    body: z.object({}).optional(),
    responses: { 204: z.undefined() }
  },
  me: {
    method: 'GET',
    path: '/auth/me',
    responses: {
      200: z.object({
        userId: z.string().uuid(),
        username: z.string(),
        role: roleSchema,
        branchId: z.string().uuid().optional(),
        registerId: z.string().uuid().optional(),
        branches: z.array(branchSchema),
        permissions: z.array(cashierPermissionSchema).default([])
      })
    }
  }
});

export const usersRoutes = c.router({
  list: {
    method: 'GET',
    path: '/users',
    query: z.object({ branchId: z.string().uuid() }),
    responses: { 200: z.array(userSchema) }
  },
  create: {
    method: 'POST',
    path: '/users',
    body: z.object({
      branchId: z.string().uuid(),
      username: requiredText,
      password: passwordSchema,
      branchIds: z
        .array(z.string().uuid())
        .superRefine(uniqueBy((id) => id, 'Branch is listed more than once'))
        .optional(),
      permissions: z.array(cashierPermissionSchema).superRefine(uniqueBy((permission) => permission, 'Permission is listed more than once')).optional()
    }),
    responses: { 201: userSchema }
  },
  update: {
    method: 'PATCH',
    path: '/users/:id',
    body: z.object({
      username: requiredText.optional(),
      password: passwordSchema.optional(),
      /**
       * With `password`: the user must choose their own at next sign-in. Defaults to true when
       * an admin sets someone else's password. Either way their sessions end.
       */
      mustChangePassword: z.boolean().optional(),
      isActive: z.boolean().optional(),
      /** Replaces the cashier's permissions. */
      permissions: z.array(cashierPermissionSchema).superRefine(uniqueBy((permission) => permission, 'Permission is listed more than once')).optional()
    }),
    responses: { 200: userSchema }
  },
  grantBranchAccess: {
    method: 'POST',
    path: '/users/:id/branches/:branchId',
    body: z.undefined(),
    responses: { 204: z.undefined() }
  },
  revokeBranchAccess: {
    method: 'DELETE',
    path: '/users/:id/branches/:branchId',
    body: z.undefined(),
    responses: { 204: z.undefined() }
  }
});
