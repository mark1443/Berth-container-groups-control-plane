import { useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, CheckCircle2, Circle, CircleDashed, Loader2, Undo2, XCircle } from 'lucide-react';
import { getGetOperationQueryKey, useGetOperation, type Operation, type OperationStep } from '@workspace/api-client-react';
import { duration, label, LIVE, stamp } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ErrorBlock, Pill, RowsSkeleton } from '@/components/berth';

const STEP_ICON: Record<string, { icon: typeof Circle; cls: string }> = {
  PENDING: { icon: Circle, cls: 'text-muted-foreground' },
  RUNNING: { icon: Loader2, cls: 'text-[hsl(var(--busy))] animate-spin' },
  SUCCEEDED: { icon: CheckCircle2, cls: 'text-[hsl(var(--ok))]' },
  FAILED: { icon: XCircle, cls: 'text-[hsl(var(--bad))]' },
  UNKNOWN: { icon: AlertTriangle, cls: 'text-[hsl(var(--warn))]' },
  SKIPPED: { icon: CircleDashed, cls: 'text-muted-foreground' },
  ROLLED_BACK: { icon: Undo2, cls: 'text-[hsl(var(--bad))]' },
};

export function StepTimeline({ steps }: { steps: OperationStep[] }) {
  if (!steps.length) return <div className="px-4 py-6 text-[13px] text-muted-foreground">No steps recorded yet.</div>;
  return (
    <ol className="relative px-4 py-3">
      {steps.map((s, i) => {
        const I = STEP_ICON[s.state] ?? STEP_ICON.PENDING;
        return (
          <li key={s.index} className="relative flex gap-3 pb-4 last:pb-0 rise" style={{ animationDelay: `${i * 40}ms` }} data-testid={`row-step-${s.index}`}>
            {i < steps.length - 1 && <span className="absolute left-[9px] top-6 bottom-0 w-px bg-border" />}
            <I.icon className={cn('size-[19px] shrink-0 bg-card relative', I.cls)} />
            <div className="min-w-0 flex-1 -mt-px">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[10.5px] text-muted-foreground tnum">#{s.index}</span>
                <span className="font-mono text-[11px] font-semibold tracking-wide">{label(s.kind)}</span>
                {s.serviceName && <span className="font-mono text-[11px] rounded-sm bg-accent px-1.5 text-accent-foreground">{s.serviceName}</span>}
                <span className="ml-auto font-mono text-[10.5px] text-muted-foreground tnum">
                  {s.startedAt ? `${stamp(s.startedAt, 'HH:mm:ss')} · ${duration(s.startedAt, s.finishedAt ?? (s.state === 'RUNNING' ? new Date() : null))}` : label(s.state).toLowerCase()}
                </span>
              </div>
              <div className="text-[13px] mt-0.5">{s.summary}</div>
              {s.error && <div className="mt-1.5 rounded-sm border-l-2 border-destructive bg-destructive/5 px-2.5 py-1.5 font-mono text-[11.5px] text-destructive">{s.error}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function OpProgress({ op }: { op: Operation }) {
  const total = op.steps.length || 1;
  const done = op.steps.filter((s) => !['PENDING', 'RUNNING'].includes(s.state)).length;
  const failed = op.steps.some((s) => s.state === 'FAILED' || s.state === 'ROLLED_BACK');
  return (
    <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all duration-500', failed ? 'bg-[hsl(var(--bad))]' : op.state === 'SUCCEEDED' ? 'bg-[hsl(var(--ok))]' : 'bg-primary')}
        style={{ width: `${(done / total) * 100}%` }}
      />
    </div>
  );
}

export function useLiveOperation(id: string, onFinish?: (op: Operation) => void) {
  const q = useGetOperation(id, {
    query: {
      enabled: !!id,
      queryKey: getGetOperationQueryKey(id),
      refetchInterval: (query) => {
        const st = (query.state.data as Operation | undefined)?.state;
        return !st || LIVE.has(st) ? 2000 : false;
      },
    },
  });
  const cb = useRef(onFinish);
  cb.current = onFinish;
  const fired = useRef<string | null>(null);
  const state = q.data?.state;
  useEffect(() => {
    if (q.data && state && !LIVE.has(state) && fired.current !== q.data.id) {
      fired.current = q.data.id;
      cb.current?.(q.data);
    }
  }, [state, q.data]);
  return q;
}

export function LiveOperationCard({ id, onFinish }: { id: string; onFinish?: (op: Operation) => void }) {
  const { data: op, isLoading, error, refetch } = useLiveOperation(id, onFinish);
  if (isLoading) return <RowsSkeleton rows={3} cols={3} />;
  if (error || !op) return <ErrorBlock error={error} onRetry={() => refetch()} className="m-4" />;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3 pb-2">
        <Pill value={op.state} />
        <Link href={`/operations/${op.id}`} className="font-mono text-[12px] hover:text-primary" data-testid="link-follow-operation">
          op/{op.id.slice(0, 8)}
        </Link>
        <span className="text-[12px] text-muted-foreground">{op.reason ?? 'No reason given'}</span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">{duration(op.startedAt ?? op.createdAt, op.finishedAt ?? new Date())}</span>
      </div>
      <div className="px-4 pb-2"><OpProgress op={op} /></div>
      {op.error && <div className="mx-4 mb-2 rounded-sm bg-destructive/5 border-l-2 border-destructive px-3 py-2 text-[12.5px] text-destructive">{op.error}</div>}
      <StepTimeline steps={op.steps} />
    </div>
  );
}
