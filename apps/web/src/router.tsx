import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { can, getSession } from './lib/session';
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
import { SuppliersPage } from './screens/SuppliersPage';
import { ExpensesPage } from './screens/ExpensesPage';
import { TransfersPage } from './screens/TransfersPage';
import { ReportsPage } from './screens/ReportsPage';
import { ActivityPage } from './screens/ActivityPage';
import { GstReturnsPage } from './screens/GstReturnsPage';
import { BranchSettingsPage } from './screens/BranchSettingsPage';
import { requireAdmin, requireManagementSession, requireOperationalSession, requirePermission, requireSession } from './screens/route-helpers';
import { WelcomePage } from './screens/onboarding/WelcomePage';
import { SetupPage } from './screens/onboarding/SetupPage';
import { RecoverPage } from './screens/onboarding/RecoverPage';
import { ChangePasswordPage } from './screens/ChangePasswordPage';
import { OwnerPasswordPage } from './screens/onboarding/OwnerPasswordPage';
import { OwnerPage } from './screens/onboarding/OwnerPage';
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
      if (session.mustChangePassword) {
        throw redirect({ to: '/change-password' });
      }
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

/**
 * "Forgot your password?": offline, an admin's with the recovery code; online, any staff
 * password, reset by the business's owner.
 */
const recoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recover',
  beforeLoad: () => {
    if (getSession() || (desktop && !desktop.config.mode)) {
      throw redirect({ to: '/' });
    }
  },
  component: RecoverPage
});

/** A forgotten owner-account password, reset with a code sent by email. */
const ownerPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/owner-password',
  validateSearch: (search: Record<string, unknown>): { email?: string } =>
    typeof search.email === 'string' && search.email ? { email: search.email } : {},
  component: OwnerPasswordPage
});

/** Online: the business owner's own screen, signed in with the owner account: staff of each business. */
const ownerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/owner',
  beforeLoad: () => {
    if (desktop && !desktop.config.mode) throw redirect({ to: '/' });
  },
  component: OwnerPage
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

/** The signed-in user's own new password; required first when one was set for them. */
const changePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/change-password',
  beforeLoad: () => {
    if (!getSession()) throw redirect({ to: '/' });
  },
  component: ChangePasswordPage
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
  beforeLoad: () => requireManagementSession(),
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
  beforeLoad: () => requireManagementSession(),
  component: CustomersPage
});

const stockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stock',
  beforeLoad: () => requireManagementSession(),
  component: StockPage
});

const purchasesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/purchases',
  beforeLoad: () => {
    requirePermission('RECORD_PURCHASES');
    return requireManagementSession();
  },
  component: PurchasesPage
});

const suppliersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/suppliers',
  beforeLoad: () => {
    const session = requireManagementSession();
    if (!can(session, 'RECORD_PURCHASES') && !can(session, 'PAY_SUPPLIERS')) throw redirect({ to: '/pos' });
    return session;
  },
  component: SuppliersPage
});

const expensesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses',
  beforeLoad: () => {
    requirePermission('CASH_AND_EXPENSES');
    return requireManagementSession();
  },
  component: ExpensesPage
});

const transfersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/transfers',
  // Cashiers receive what arrives at their branch; sending needs SEND_TRANSFERS.
  beforeLoad: () => requireManagementSession(),
  component: TransfersPage
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  beforeLoad: () => requireAdmin(),
  component: ReportsPage
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activity',
  beforeLoad: () => requireAdmin(),
  component: ActivityPage
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
  // A tab to open on, e.g. ?tab=billing from the subscription banner.
  validateSearch: (search: Record<string, unknown>): { tab?: string } => (typeof search.tab === 'string' ? { tab: search.tab } : {}),
  component: BranchSettingsPage
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  welcomeRoute,
  createBusinessRoute,
  recoverRoute,
  ownerPasswordRoute,
  ownerRoute,
  changePasswordRoute,
  setupRoute,
  openRegisterRoute,
  posRoute,
  salesRoute,
  returnsRoute,
  itemsRoute,
  customersRoute,
  stockRoute,
  purchasesRoute,
  suppliersRoute,
  expensesRoute,
  transfersRoute,
  reportsRoute,
  activityRoute,
  gstRoute,
  settingsRoute
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
