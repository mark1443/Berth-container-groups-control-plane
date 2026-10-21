import { type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { queryClient } from '@/lib/api';
import { AuthGate } from '@/components/shell';
import Overview from '@/pages/overview';
import Providers from '@/pages/providers';
import ProviderDetail from '@/pages/provider-detail';
import Workloads from '@/pages/workloads';
import WorkloadDetail from '@/pages/workload-detail';
import Groups from '@/pages/groups';
import GroupDetailPage from '@/pages/group-detail';
import Operations from '@/pages/operations';
import OperationDetail from '@/pages/operation-detail';
import Activity from '@/pages/activity';

function Router() {
  return (
    <AuthGate>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/providers" component={Providers} />
          <Route path="/providers/:id" component={ProviderDetail} />
          <Route path="/workloads" component={Workloads} />
          <Route path="/workloads/:id" component={WorkloadDetail} />
          <Route path="/groups" component={Groups} />
          <Route path="/groups/:id" component={GroupDetailPage} />
          <Route path="/operations" component={Operations} />
          <Route path="/operations/:id" component={OperationDetail} />
          <Route path="/activity" component={Activity} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </AuthGate>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
