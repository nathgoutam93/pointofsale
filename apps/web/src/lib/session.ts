export type Session = {
  token: string;
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
};

const SESSION_KEY = 'pos_session';

export function getSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function setSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function updateSession(partial: Partial<Session>) {
  const current = getSession();
  if (!current) return;
  setSession({ ...current, ...partial });
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
