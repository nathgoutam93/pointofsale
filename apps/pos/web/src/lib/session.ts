import { hasPermission, type CashierPermission } from '@pos/contracts';

/**
 * Who is signed in, for the screens (role, branch, register). The sign-in itself is an httpOnly
 * cookie the API manages; no token is kept where page scripts could read it.
 */
export type Session = {
  userId: string;
  branchId: string | null;
  registerId: string | null;
  /** The counter the open register runs on (older sessions don't have it). */
  counterId?: string | null;
  counterName?: string | null;
  branches: Array<{ id: string; name: string; code: string }>;
  username?: string;
  role: 'ADMIN' | 'CASHIER';
  /** Their password was set for them: they choose their own before anything else. */
  mustChangePassword?: boolean;
  /** Cashiers: what an admin let them do beyond selling (see `can`). */
  permissions?: CashierPermission[];
};

const SESSION_KEY = 'pos_session';

/** Whether the signed-in user may do `permission`: admins always, cashiers when allowed. */
export function can(session: Pick<Session, 'role' | 'permissions'> | null | undefined, permission: CashierPermission) {
  return !!session && hasPermission(session, permission);
}

/**
 * Whether the user may see what goods cost (cost prices, purchase history): admins, and cashiers
 * who adjust stock or record purchases. The API leaves costs out for everyone else.
 */
export function canSeeCosts(session: Pick<Session, 'role' | 'permissions'> | null | undefined) {
  return can(session, 'MANAGE_STOCK') || can(session, 'RECORD_PURCHASES');
}

/** The session as answered by the API, whose blank `token` field is not kept. */
type AnswerSession = Session & { token?: unknown };

export function getSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as AnswerSession;
    // Older versions kept the token here; drop it (the API asks to sign in again).
    if ('token' in stored) setSession(stored);
    return stored;
  } catch {
    return null;
  }
}

export function setSession(session: AnswerSession) {
  const { token: _token, ...kept } = session;
  localStorage.setItem(SESSION_KEY, JSON.stringify(kept));
}

export function updateSession(partial: Partial<AnswerSession>) {
  const current = getSession();
  if (!current) return;
  setSession({ ...current, ...partial });
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
