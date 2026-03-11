export type Session = {
  token: string;
  userId: string;
  branchId: string | null;
  registerId: string | null;
  branches: Array<{ id: string; name: string; code: string }>;
  username?: string;
  role: 'ADMIN' | 'CASHIER';
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
