import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ago, errCode, errMsg, label, LIVE, stamp, toneOf, type Tone } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export function Pill({ value, tone, live, className }: { value: string; tone?: Tone; live?: boolean; className?: string }) {
  const t = tone ?? toneOf(value);
  const isLive = live ?? LIVE.has(value);
  return (
    <span className={cn('pill', `tone-${t}`, className)} data-testid={`status-${value.toLowerCase()}`}>
      <span className={cn('dot', isLive && 'dot-live')} />
      {label(value)}
    </span>
  );
}

export function WorkloadPill({ value }: { value: string }) {
  return <Pill value={value} tone={value === 'RUNNING' ? 'ok' : undefined} live={false} />;
}

export function PageHeader({ eyebrow, title, meta, actions, children }: { eyebrow?: ReactNode; title: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 rise">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
          <h1 className="font-display text-[28px] md:text-[34px] font-bold leading-none text-foreground truncate" data-testid="text-page-title">
            {title}
          </h1>
          {meta && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Panel({ title, count, actions, children, className, bodyClass, delay = 0 }: { title?: ReactNode; count?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; delay?: number }) {
  return (
    <section className={cn('rounded-md border border-card-border bg-card shadow-sm rise', className)} style={{ animationDelay: `${delay}ms` }}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-card-border px-4 h-11">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-[13px] font-semibold tracking-tight truncate">{title}</h2>
            {count !== undefined && <span className="font-mono text-[11px] text-muted-foreground tnum">{count}</span>}
          </div>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Empty({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center px-6 py-12 chart-grid', className)} data-testid="state-empty">
      <div className="relative mb-4 grid place-items-center size-12 rounded-full border border-dashed border-primary/40 text-primary">
        {icon}
        <span className="absolute -inset-2 rounded-full border border-primary/10" />
      </div>
      <div className="font-display text-[17px] font-semibold">{title}</div>
      {body && <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground leading-relaxed">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBlock({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const code = errCode(error);
  return (
    <div className={cn('flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4', className)} data-testid="state-error">
      <AlertTriangle className="size-4 text-destructive mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-destructive">{errMsg(error)}</div>
        {code && <div className="font-mono text-[11px] text-muted-foreground mt-1">{code}</div>}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} data-testid="button-retry">
          <RotateCw /> Retry
        </Button>
      )}
    </div>
  );
}

export function RowsSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-border" data-testid="state-loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3" style={{ opacity: 1 - i * 0.12 }}>
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className={cn('h-3.5 rounded-sm', j === 0 ? 'w-40' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Pager({ page, totalPages, totalItems, onPage }: { page: number; totalPages: number; totalItems: number; onPage: (p: number) => void }) {
  if (totalItems === 0) return null;
  return (
    <div className="flex items-center justify-between border-t border-card-border px-4 h-10 text-[12px] text-muted-foreground">
      <span className="font-mono tnum">{totalItems} total · page {page} of {Math.max(totalPages, 1)}</span>
      <div className="flex gap-1">
        <Button size="icon" variant="ghost" className="size-7" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="button-page-prev">
          <ChevronLeft />
        </Button>
        <Button size="icon" variant="ghost" className="size-7" disabled={page >= totalPages} onClick={() => onPage(page + 1)} data-testid="button-page-next">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function When({ v, abs }: { v: unknown; abs?: boolean }) {
  return (
    <time className="tnum whitespace-nowrap" title={stamp(v, 'PPpp')}>
      {abs ? stamp(v) : ago(v)}
    </time>
  );
}

export function KV({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(110px,auto)_1fr] text-[13px]', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="border-b border-border/70 py-2 pr-4 text-muted-foreground">{k}</dt>
          <dd className="border-b border-border/70 py-2 min-w-0 break-words">{v ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn('inline-grid place-items-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors', className)}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      data-testid="button-copy"
      aria-label="Copy"
    >
      {done ? <Check className="size-3.5 text-[hsl(var(--ok))] pop" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function PortTag({ port, proto, className }: { port: number | null | undefined; proto?: string; className?: string }) {
  if (port == null) return <span className="text-muted-foreground font-mono text-[12px]">—</span>;
  return (
    <span className={cn('inline-flex items-baseline font-mono text-[12px] tnum', className)}>
      <span className="text-muted-foreground">:</span>
      <span className="font-semibold">{port}</span>
      {proto && <span className="ml-1 text-[10px] text-muted-foreground">{proto.toLowerCase()}</span>}
    </span>
  );
}

export function Stat({ label: l, value, sub, tone, delay = 0 }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; delay?: number }) {
  return (
    <div className={cn('rise relative px-4 py-3.5', tone && `tone-${tone}`)} style={{ animationDelay: `${delay}ms` }}>
      <div className="eyebrow">{l}</div>
      <div className={cn('mt-1.5 font-display text-[30px] font-bold leading-none tnum', tone && 'text-[hsl(var(--t))]')}>{value}</div>
      {sub && <div className="mt-2 text-[12px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function FilterChip({ active, children, onClick, testId }: { active: boolean; children: ReactNode; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'h-7 px-2.5 rounded text-[12px] font-medium transition-all border',
        active ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40',
      )}
    >
      {children}
    </button>
  );
}
