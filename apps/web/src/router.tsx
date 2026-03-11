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
import { ReportsPage } from './screens/ReportsPage';
import { BranchSettingsPage } from './screens/BranchSettingsPage';
import { requireAdmin, requireOperationalSession, requireSession } from './screens/route-helpers';

const rootRoute = createRootRoute({ component: AppLayout });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    const session = getSession();
    if (session) {
      if (session.branchId && session.registerId) {
        throw redirect({ to: '/pos' });
      }
      throw redirect({ to: '/open-register' });
    }
  },
  component: LoginPage
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

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  beforeLoad: () => requireAdmin(),
  component: ReportsPage
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: () => requireAdmin(),
  component: BranchSettingsPage
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  openRegisterRoute,
  posRoute,
  salesRoute,
  returnsRoute,
  itemsRoute,
  customersRoute,
  stockRoute,
  reportsRoute,
  settingsRoute
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
