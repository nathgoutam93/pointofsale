export type Session = {
    token: string;
    userId: string;
    branchId: string;
    role: 'ADMIN' | 'CASHIER';
};
export declare function getSession(): Session | null;
export declare function setSession(session: Session): void;
export declare function clearSession(): void;
//# sourceMappingURL=session.d.ts.map