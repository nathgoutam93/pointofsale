import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { getSession } from './lib/session';
import { AppLayout } from './screens/AppLayout';
import { LoginPage } from './screens/LoginPage';
import { PosPage } from './screens/PosPage';
import { SalesPage } from './screens/SalesPage';
import { ItemsPage } from './screens/ItemsPage';
import { CustomersPage } from './screens/CustomersPage';
import { StockPage } from './screens/StockPage';
import { ReportsPage } from './screens/ReportsPage';
import { BranchSettingsPage } from './screens/BranchSettingsPage';
import { requireAdmin, requireSession } from './screens/route-helpers';

const rootRoute = createRootRoute({ component: AppLayout });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    if (getSession()) {
      throw redirect({ to: '/pos' });
    }
  },
  component: LoginPage
});

const posRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pos',
  beforeLoad: () => requireSession(),
  component: PosPage
});

const salesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sales',
  beforeLoad: () => requireSession(),
  component: SalesPage
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
  beforeLoad: () => requireSession(),
  component: CustomersPage
});

const stockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stock',
  beforeLoad: () => requireSession(),
  component: StockPage
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  beforeLoad: () => requireSession(),
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
  posRoute,
  salesRoute,
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
