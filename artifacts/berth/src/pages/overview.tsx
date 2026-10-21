import { Link } from 'wouter';
import { Activity, ArrowUpRight, Waves } from 'lucide-react';
import { getGetOverviewQueryKey, useGetOverview, useListEvents } from '@workspace/api-client-react';
import { ago, duration } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Empty, ErrorBlock, PageHeader, Panel, Pill, PortTag, RowsSkeleton, Stat, When } from '@/components/berth';
import { EventRow } from '@/components/feed';
import { Skeleton } from '@/components/ui/skeleton';

function Bar({ parts }: { parts: { n: number; tone: string; label: string }[] }) {
  const total = parts.reduce((a, b) => a + b.n, 0) || 1;
  return (
    <div>
      <div className="flex h-2 rounded-sm overflow-hidden bg-muted">
        {parts.map((p) => p.n > 0 && <div key={p.label} className={cn(`tone-${p.tone}`, 'bg-[hsl(var(--t))] transition-all duration-700')} style={{ width: `${(p.n / total) * 100}%` }} title={`${p.label}: ${p.n}`} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {parts.map((p) => (
          <span key={p.label} className={cn(`tone-${p.tone}`, 'inline-flex items-center gap-1.5 text-[11px] text-muted-foreground')}>
            <span className="dot" /> {p.label} <span className="font-mono text-foreground tnum">{p.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Overview() {
  const { data: ov, isLoading, error, refetch } = useGetOverview({ query: { queryKey: getGetOverviewQueryKey(), refetchInterval: 15000 } });
  const ev = useListEvents({ pageSize: 14 });

  if (error) return <ErrorBlock error={error} onRetry={() => refetch()} />;
  return (
    <div>
      <PageHeader
        eyebrow="Estate overview"
        title="Harbour board"
        meta={ov ? <span className="font-mono text-[11.5px]">soundings taken {ago(ov.generatedAt)} · refreshes every 15s</span> : <Skeleton className="h-3 w-48" />}
      />
      {isLoading || !ov ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-md overflow-hidden border border-card-border bg-card-border mb-6">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="bg-card p-4"><Skeleton className="h-3 w-20 mb-3" /><Skeleton className="h-7 w-14" /></div>)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px rounded-md overflow-hidden border border-card-border bg-card-border mb-4 shadow-sm">
            <Link href="/providers" className="bg-card hover:bg-accent/40 transition-colors" data-testid="link-stat-providers"><Stat label="Providers" value={ov.providers.total} sub={`${ov.providers.online} online`} /></Link>
            <Link href="/workloads" className="bg-card hover:bg-accent/40 transition-colors" data-testid="link-stat-workloads"><Stat label="Workloads" value={ov.workloads.total} sub={`${ov.workloads.unmanaged} without a berth`} delay={40} /></Link>
            <Link href="/groups" className="bg-card hover:bg-accent/40 transition-colors" data-testid="link-stat-groups"><Stat label="Berths" value={ov.groups.total} sub={`${ov.groups.applied} applied`} tone="brand" delay={80} /></Link>
            <Link href="/operations" className="bg-card hover:bg-accent/40 transition-colors" data-testid="link-stat-operations"><Stat label="Ops · 24h" value={ov.operations.last24h} sub={<>{ov.operations.failed24h} failed · {ov.operations.running} running · {ov.operations.allocatedPorts} ports held</>} tone={ov.operations.failed24h ? 'bad' : undefined} delay={120} /></Link>
          </div>
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <Panel title="Provider health" bodyClass="p-4" delay={60}>
              <Bar parts={[{ n: ov.providers.online, tone: 'ok', label: 'online' }, { n: ov.providers.degraded, tone: 'warn', label: 'degraded' }, { n: ov.providers.offline, tone: 'bad', label: 'offline' }]} />
            </Panel>
            <Panel title="Workload state" bodyClass="p-4" delay={100}>
              <Bar parts={[{ n: ov.workloads.running, tone: 'ok', label: 'running' }, { n: ov.workloads.stopped, tone: 'idle', label: 'stopped' }, { n: ov.workloads.missing, tone: 'bad', label: 'missing' }]} />
              <div className="mt-3 text-[11.5px] text-muted-foreground"><span className="font-mono text-foreground">{ov.workloads.managed}</span> berthed · <span className="font-mono text-foreground">{ov.workloads.unmanaged}</span> adrift</div>
            </Panel>
            <Panel title="Berth status" bodyClass="p-4" delay={140}>
              <Bar parts={[{ n: ov.groups.applied, tone: 'ok', label: 'applied' }, { n: ov.groups.drifted, tone: 'warn', label: 'drifted' }, { n: ov.groups.failed, tone: 'bad', label: 'failed' }, { n: ov.groups.applying, tone: 'busy', label: 'applying' }, { n: ov.groups.draft, tone: 'idle', label: 'draft' }]} />
            </Panel>
          </div>
        </>
      )}

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-4">
        <div className="space-y-4 min-w-0">
          <Panel title="Drifted berths" count={ov?.driftedGroups.length} delay={120} actions={<Waves className="size-4 text-[hsl(var(--warn))]" />}>
            {!ov ? <RowsSkeleton rows={2} cols={3} /> : !ov.driftedGroups.length ? (
              <div className="flex items-center gap-3 px-4 py-4 text-[13px] text-muted-foreground"><span className="tone-ok dot" /> Every applied berth matches what is running.</div>
            ) : (
              <ul className="divide-y divide-border">
                {ov.driftedGroups.map((g, i) => (
                  <li key={g.id} className="rise" style={{ animationDelay: `${i * 30}ms` }}>
                    <Link href={`/groups/${g.id}`} className="block px-4 py-3 row-hover" data-testid={`link-drifted-${g.id}`}>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[13px] font-semibold">{g.name}</span>
                        <Pill value={g.status} />
                        <span className="text-[12px] text-muted-foreground">{g.providerName}</span>
                        <PortTag port={g.entryPort} proto={g.protocol} className="ml-auto" />
                      </div>
                      <ul className="mt-1.5 space-y-0.5">
                        {g.driftReasons.slice(0, 3).map((r) => <li key={r} className="text-[12px] text-muted-foreground pl-3 border-l-2 border-[hsl(var(--warn)/.5)]">{r}</li>)}
                      </ul>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Recent operations" delay={160} actions={<Link href="/operations" className="text-[12px] text-muted-foreground hover:text-primary inline-flex items-center gap-1" data-testid="link-all-operations">All <ArrowUpRight className="size-3" /></Link>}>
            {!ov ? <RowsSkeleton rows={4} cols={4} /> : !ov.recentOperations.length ? (
              <Empty icon={<Activity className="size-5" />} title="No operations yet" body="Apply a berth to see its operation here." className="py-8" />
            ) : (
              <ul className="divide-y divide-border">
                {ov.recentOperations.map((o, i) => (
                  <li key={o.id} className="rise" style={{ animationDelay: `${i * 30}ms` }}>
                    <Link href={`/operations/${o.id}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 row-hover" data-testid={`link-op-${o.id}`}>
                      <Pill value={o.state} />
                      <div className="min-w-0">
                        <div className="text-[13px] truncate"><span className="font-mono font-semibold">{o.groupName}</span> <span className="text-muted-foreground">· {o.kind.toLowerCase()} · {o.steps.length} steps</span></div>
                        {o.reason && <div className="text-[11.5px] text-muted-foreground truncate">{o.reason}</div>}
                      </div>
                      <div className="text-right text-[11px] text-muted-foreground">
                        <When v={o.createdAt} />
                        <div className="font-mono text-[10px]">{duration(o.startedAt, o.finishedAt)}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <Panel title="Recent activity" delay={200} actions={<Link href="/activity" className="text-[12px] text-muted-foreground hover:text-primary inline-flex items-center gap-1" data-testid="link-all-activity">Full log <ArrowUpRight className="size-3" /></Link>}>
          {ev.isLoading ? <RowsSkeleton rows={8} cols={2} /> : ev.error ? <ErrorBlock error={ev.error} onRetry={() => ev.refetch()} className="m-4" /> : !ev.data?.data.length ? (
            <Empty icon={<Activity className="size-5" />} title="Quiet waters" body="Nothing has happened yet." className="py-8" />
          ) : (
            <ul className="divide-y divide-border">{ev.data.data.map((e, i) => <EventRow key={e.id} e={e} i={i} compact />)}</ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
