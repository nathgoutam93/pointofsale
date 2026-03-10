import { initClient } from '@ts-rest/core';
import { appContract } from '@pos/contracts';
import { getSession } from './session';
export const api = initClient(appContract, {
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001',
    baseHeaders: {}
});
export function authHeaders() {
    const session = getSession();
    if (!session)
        return {};
    return {
        Authorization: `Bearer ${session.token}`
    };
}
//# sourceMappingURL=api.js.map