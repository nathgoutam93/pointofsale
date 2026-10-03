import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { getSession } from './lib/session';
import { AppLayout } from './screens/AppLayout';
import { LoginPage } from './screens/LoginPage';
import { OpenRegisterPage } from './screens/OpenRegisterPage';
import { PosPage } from './screens/PosPage';
import { SalesPage } from './screens/SalesPage';
import { ReturnsPage } from './screens/ReturnsPage';
import { ItemsPage } from './screens/ItemsPage';
import { CustomersPage } from './screens/CustomersPage';
import { StockPage } from './screens/StockPage';
import { PurchasesPage } from './screens/PurchasesPage';
import { TransfersPage } from './screens/TransfersPage';
import { ReportsPage } from './screens/ReportsPage';
import { GstReturnsPage } from './screens/GstReturnsPage';
import { BranchSettingsPage } from './screens/BranchSettingsPage';
import { requireAdmin, requireOperationalSession, requireSession } from './screens/route-helpers';
import { WelcomePage } from './screens/onboarding/WelcomePage';
import { SetupPage } from './screens/onboarding/SetupPage';
import { RecoverPage } from './screens/onboarding/RecoverPage';
import { api } from './lib/api';
import { desktop } from './lib/desktop';

const rootRoute = createRootRoute({ component: AppLayout });

type SalesSearch = {
  paymentFilter?: 'PENDING' | 'SETTLED';
  customerId?: string;
  q?: string;
  status?: string;
};

/** True when the API is a fresh offline install that needs its business and admin created. */
async function setupRequired() {
  try {
    const res = await api.meta.get();
    return res.status === 200 && res.body.setupRequired;
  } catch {
    // API not reachable: show sign-in, which reports the problem when used.
    return false;
  }
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async () => {
    if (desktop && !desktop.config.mode) {
      throw redirect({ to: '/welcome' });
    }
    const session = getSession();
    if (session) {
      if (session.branchId && session.registerId) {
        throw redirect({ to: '/pos' });
      }
      throw redirect({ to: '/open-register' });
    }
    if (await setupRequired()) {
      throw redirect({ to: '/setup' });
    }
  },
  component: LoginPage
});

/** Desktop app, first launch only: choose a single-counter (offline) or online business. */
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/welcome',
  beforeLoad: () => {
    if (!desktop || desktop.config.mode) {
      throw redirect({ to: '/' });
    }
  },
  component: WelcomePage
});

/** Offline: a forgotten admin password, reset with the recovery code. */
const recoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recover',
  beforeLoad: () => {
    if (getSession() || (desktop && desktop.config.mode !== 'offline')) {
      throw redirect({ to: '/' });
    }
  },
  component: RecoverPage
});

/** Desktop app, first launch: create a business on the online server. */
const createBusinessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/create-business',
  beforeLoad: () => {
    if (!desktop || desktop.config.mode) {
      throw redirect({ to: '/' });
    }
  },
  component: () => <SetupPage online />
});

/** Offline install with no users yet: create the business and its admin. */
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  beforeLoad: async () => {
    if (getSession() || !(await setupRequired())) {
      throw redirect({ to: '/' });
    }
  },
  component: SetupPage
});

const openRegisterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/open-register',
  beforeLoad: () => requireSession(),
  component: OpenRegisterPage
});

const posRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pos',
  beforeLoad: () => requireOperationalSession(),
  component: PosPage
});

const salesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sales',
  beforeLoad: () => requireOperationalSession(),
  validateSearch: (search: Record<string, unknown>): SalesSearch => {
    const parsed: SalesSearch = {};
    if (search.paymentFilter === 'PENDING' || search.paymentFilter === 'SETTLED') {
      parsed.paymentFilter = search.paymentFilter;
    }
    if (typeof search.customerId === 'string') parsed.customerId = search.customerId;
    if (typeof search.q === 'string') parsed.q = search.q;
    if (typeof search.status === 'string') parsed.status = search.status;
    return parsed;
  },
  component: SalesPage
});

const returnsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/returns',
  beforeLoad: () => requireOperationalSession(),
  component: ReturnsPage
});

const itemsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/items',
  beforeLoad: () => requireSession(),
  component: ItemsPage
});

const customersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers',
  beforeLoad: () => requireOperationalSession(),
  component: CustomersPage
});

const stockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stock',
  beforeLoad: () => requireOperationalSession(),
  component: StockPage
});

const purchasesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/purchases',
  beforeLoad: () => {
    requireAdmin();
    requireOperationalSession();
  },
  component: PurchasesPage
});

const transfersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/transfers',
  beforeLoad: () => {
    requireAdmin();
    requireOperationalSession();
  },
  component: TransfersPage
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  beforeLoad: () => requireAdmin(),
  component: ReportsPage
});

const gstRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/gst',
  beforeLoad: () => requireAdmin(),
  component: GstReturnsPage
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: () => requireAdmin(),
  component: BranchSettingsPage
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  welcomeRoute,
  createBusinessRoute,
  recoverRoute,
  setupRoute,
  openRegisterRoute,
  posRoute,
  salesRoute,
  returnsRoute,
  itemsRoute,
  customersRoute,
  stockRoute,
  purchasesRoute,
  transfersRoute,
  reportsRoute,
  gstRoute,
  settingsRoute
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
