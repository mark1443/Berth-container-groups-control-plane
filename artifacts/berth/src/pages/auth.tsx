import { ArrowRight, LogOut, ShieldOff } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { Button } from '@/components/ui/button';

function HarbourChart({ dim }: { dim?: boolean }) {
  const berths = Array.from({ length: 9 });
  return (
    <svg viewBox="0 0 520 520" className="w-full h-full" aria-hidden>
      <defs>
        <pattern id="g" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M26 0H0V26" fill="none" stroke="hsl(40 30% 88% / .06)" />
        </pattern>
      </defs>
      <rect width="520" height="520" fill="url(#g)" />
      {[60, 120, 180, 240].map((r, i) => (
        <circle key={r} cx="430" cy="420" r={r} fill="none" stroke="hsl(40 30% 88% / .08)" strokeDasharray={i % 2 ? '2 6' : undefined} />
      ))}
      <path d="M40 90 H360" stroke="hsl(40 30% 88% / .5)" strokeWidth="3" />
      {berths.map((_, i) => {
        const y = 90 + i * 40;
        const filled = dim ? i === 4 : [0, 1, 3, 4, 6, 7].includes(i);
        const accent = !dim && i === 3;
        return (
          <g key={i} className="rise" style={{ animationDelay: `${200 + i * 60}ms` }}>
            <path d={`M60 ${y} V${y + 30}`} stroke="hsl(40 30% 88% / .35)" />
            <text x="40" y={y + 22} fill="hsl(40 30% 88% / .4)" fontFamily="JetBrains Mono" fontSize="10">{String(i + 1).padStart(2, '0')}</text>
            <rect x="72" y={y + 6} width={filled ? 150 + ((i * 37) % 120) : 40} height="20" rx="2" fill={accent ? 'hsl(12 84% 54%)' : filled ? 'hsl(40 30% 88% / .16)' : 'none'} stroke={filled ? 'none' : 'hsl(40 30% 88% / .25)'} strokeDasharray={filled ? undefined : '3 3'} />
            {filled && <text x={filled ? 80 : 0} y={y + 20} fill={accent ? 'hsl(40 40% 97%)' : 'hsl(40 30% 88% / .6)'} fontFamily="JetBrains Mono" fontSize="9.5">:{8000 + i * 7 + 3}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function Splash() {
  return (
    <div className="min-h-[100dvh] grid place-items-center bg-sidebar">
      <div className="flex flex-col items-center gap-4">
        <div className="size-10 rounded-md bg-primary sweep" />
        <div className="font-mono text-[11px] tracking-[.2em] uppercase text-sidebar-foreground/60">Taking soundings</div>
      </div>
    </div>
  );
}

export function LoginScreen({ expired }: { expired?: boolean }) {
  const { login } = useAuth();
  return (
    <div className="min-h-[100dvh] grid md:grid-cols-[1.1fr_1fr] bg-background">
      <div className="relative hidden md:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-10 overflow-hidden">
        <div className="font-mono text-[11px] tracking-[.2em] uppercase text-sidebar-foreground/50">Chart 01 · estate berthing plan</div>
        <div className="absolute inset-0 opacity-90"><HarbourChart /></div>
        <div className="relative max-w-sm">
          <p className="font-display text-[22px] leading-snug text-sidebar-accent-foreground">Every container has a berth. Every port is accounted for.</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm rise">
          <div className="flex items-center gap-2.5 mb-10">
            <svg viewBox="0 0 32 32" className="size-9"><rect x="1" y="1" width="30" height="30" rx="5" fill="hsl(var(--primary))" /><path d="M8 10h16M8 16h16M8 22h16" stroke="hsl(var(--primary-foreground))" strokeWidth="2.2" strokeLinecap="round" /></svg>
            <span className="font-display text-[26px] font-bold">Berth</span>
          </div>
          <div className="eyebrow mb-3">{expired ? 'Session ended' : 'Operator console'}</div>
          <h1 className="font-display text-[40px] font-bold leading-[1.02]">Sign the harbour log.</h1>
          <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
            {expired ? 'Your session expired. Log in again to pick up where you left off.' : 'Berth tracks what runs on your Docker hosts and ECS clusters, and applies every change as an audited operation. Log in to continue.'}
          </p>
          <Button size="lg" className="mt-8 w-full h-12 text-[15px] group" onClick={login} data-testid="button-login">
            Log in <ArrowRight className="transition-transform group-hover:translate-x-1" />
          </Button>
          <div className="mt-10 grid grid-cols-3 gap-px bg-border rounded overflow-hidden border border-border">
            {[['dry-run', 'plans first'], ['idempotent', 'applies'], ['audited', 'every step']].map(([a, b]) => (
              <div key={a} className="bg-card px-3 py-2.5">
                <div className="font-mono text-[11px] font-semibold">{a}</div>
                <div className="text-[11px] text-muted-foreground">{b}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AccessDenied() {
  const { logout, user } = useAuth();
  return (
    <div className="min-h-[100dvh] grid md:grid-cols-[1fr_1.1fr] bg-background">
      <div className="flex items-center justify-center p-8 order-2 md:order-1">
        <div className="w-full max-w-md rise">
          <div className="inline-grid place-items-center size-12 rounded-md bg-destructive/10 text-destructive mb-6"><ShieldOff className="size-5" /></div>
          <div className="eyebrow mb-3">403 · not on the crew list</div>
          <h1 className="font-display text-[38px] font-bold leading-[1.05]">This harbour isn't yours to steer.</h1>
          <p className="mt-4 text-[14px] text-muted-foreground leading-relaxed">
            You are signed in{user?.email ? <> as <span className="font-mono text-foreground">{user.email}</span></> : ''}, but this account is not an operator of this Berth instance. Ask an existing operator to add you, or log out and use a different account.
          </p>
          <Button size="lg" variant="outline" className="mt-8 h-11" onClick={logout} data-testid="button-logout-denied">
            <LogOut /> Log out
          </Button>
        </div>
      </div>
      <div className="relative bg-sidebar overflow-hidden min-h-[220px] order-1 md:order-2">
        <div className="absolute inset-0 opacity-70"><HarbourChart dim /></div>
      </div>
    </div>
  );
}
