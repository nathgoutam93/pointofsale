const SESSION_KEY = 'pos_session';
export function getSession() {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function setSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
export function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}
//# sourceMappingURL=session.js.map