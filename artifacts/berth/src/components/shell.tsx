import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, Anchor, Boxes, LayoutGrid, ListTree, LogOut, Menu, Server, X } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useGetOverview, useHealthCheck } from '@workspace/api-client-react';
import { accessSignal } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AccessDenied, LoginScreen, Splash } from '@/pages/auth';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutGrid, key: 'ov' },
  { href: '/groups', label: 'Berths', icon: Anchor, key: 'groups' },
  { href: '/workloads', label: 'Workloads', icon: Boxes, key: 'workloads' },
  { href: '/providers', label: 'Providers', icon: Server, key: 'providers' },
  { href: '/operations', label: 'Operations', icon: ListTree, key: 'ops' },
  { href: '/activity', label: 'Activity', icon: Activity, key: 'act' },
];

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="5" fill="hsl(var(--primary))" />
      <path d="M8 10h16M8 16h16M8 22h16" stroke="hsl(var(--primary-foreground))" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 7v18M20 7v18" stroke="hsl(var(--primary-foreground))" strokeOpacity=".45" strokeWidth="1.4" />
    </svg>
  );
}
export { Mark };

function SideNav({ onNav }: { onNav?: () => void }) {
  const [loc] = useLocation();
  const { data: ov } = useGetOverview();
  const { data: health, isError } = useHealthCheck();
  const { user, logout } = useAuth();
  const badges: Record<string, number | undefined> = {
    groups: ov ? ov.groups.drifted + ov.groups.failed : undefined,
    ops: ov?.operations.running,
  };
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Operator';
  const initials = name.split(/[\s@.]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-sidebar-border">
        <Mark className="size-7" />
        <div>
          <div className="font-display text-[19px] font-bold leading-none text-sidebar-accent-foreground">Berth</div>
          <div className="font-mono text-[9.5px] tracking-[.18em] uppercase text-sidebar-foreground/50 mt-1">harbour control</div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map((n, i) => {
          const active = n.href === '/' ? loc === '/' : loc.startsWith(n.href);
          const b = badges[n.key];
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNav}
              data-testid={`link-nav-${n.key}`}
              className={cn(
                'group relative flex items-center gap-3 rounded px-3 h-9 text-[13.5px] font-medium transition-colors rise',
                active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/50',
              )}
              style={{ animationDelay: `${i * 35}ms` }}
            >
              <span className={cn('absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-sidebar-primary transition-transform origin-left', active ? 'scale-x-100' : 'scale-x-0')} />
              <n.icon className={cn('size-4', active ? 'text-sidebar-primary' : 'opacity-70')} />
              <span className="flex-1">{n.label}</span>
              {!!b && <span className="font-mono text-[10.5px] tnum rounded-sm px-1.5 py-px bg-sidebar-primary text-sidebar-primary-foreground">{b}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-3 border-t border-sidebar-border font-mono text-[10.5px] text-sidebar-foreground/55 flex items-center gap-2" data-testid="status-api">
        <span className={cn('dot', isError ? 'tone-bad' : 'tone-ok', !isError && 'dot-live')} />
        {isError ? 'API unreachable' : `API ${health?.status ?? '...'}${health?.version ? ` · v${health.version}` : ''}`}
      </div>
      <div className="flex items-center gap-3 px-4 py-3 border-t border-sidebar-border">
        <Avatar className="size-8 rounded">
          {user?.profileImageUrl && <AvatarImage src={user.profileImageUrl} />}
          <AvatarFallback className="rounded bg-sidebar-accent text-[11px] font-semibold text-sidebar-accent-foreground">{initials || 'OP'}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-sidebar-accent-foreground" data-testid="text-user-name">{name}</div>
          <div className="text-[10.5px] text-sidebar-foreground/50">Operator</div>
        </div>
        <button onClick={logout} className="grid place-items-center size-8 rounded text-sidebar-foreground/60 hover:text-sidebar-primary hover:bg-sidebar-accent transition-colors" title="Log out" data-testid="button-logout">
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-[100dvh] bg-background">
      <aside className="hidden md:block fixed inset-y-0 left-0 w-60 z-30">
        <SideNav />
      </aside>
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2">
          <Mark className="size-6" />
          <span className="font-display font-bold text-sidebar-accent-foreground">Berth</span>
        </div>
        <button onClick={() => setOpen(true)} data-testid="button-menu" className="p-2">
          <Menu className="size-5" />
        </button>
      </div>
      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">
            <SideNav onNav={() => setOpen(false)} />
            <button className="absolute top-4 right-3 text-sidebar-foreground" onClick={() => setOpen(false)}>
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}
      <main className="md:pl-60">
        <div className="mx-auto max-w-[1400px] px-4 md:px-8 py-6 md:py-8">{children}</div>
      </main>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const access = useSyncExternalStore(accessSignal.subscribe, accessSignal.get);
  if (isLoading) return <Splash />;
  if (!isAuthenticated || access === 'unauthenticated') return <LoginScreen expired={isAuthenticated} />;
  if (access === 'forbidden') return <AccessDenied />;
  return <Shell>{children}</Shell>;
}
