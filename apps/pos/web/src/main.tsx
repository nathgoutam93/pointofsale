import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { UpdateNotices } from './components/UpdateNotices';
import { CrashBoundary } from './components/CrashBoundary';
import { watchForCrashes } from './lib/crash';
import './index.css';

const queryClient = new QueryClient();
watchForCrashes();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CrashBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <UpdateNotices />
      </QueryClientProvider>
    </CrashBoundary>
  </React.StrictMode>
);
