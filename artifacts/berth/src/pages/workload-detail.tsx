import { Link, useParams } from 'wouter';
import { Anchor, ArrowLeft, HardDrive } from 'lucide-react';
import { getGetWorkloadQueryKey, useGetWorkload } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { CopyButton, Empty, ErrorBlock, KV, PageHeader, Panel, Pill, When, WorkloadPill } from '@/components/berth';

export default function WorkloadDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const { data: w, isLoading, error, refetch } = useGetWorkload(id, { query: { enabled: !!id, queryKey: getGetWorkloadQueryKey(id) } });
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (error || !w) return <ErrorBlock error={error} onRetry={() => refetch()} />;
  const labels = Object.entries(w.labels);
  return (
    <div>
      <Link href="/workloads" className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground mb-3" data-testid="link-back-workloads"><ArrowLeft className="size-3.5" /> Workloads</Link>
      <PageHeader
        eyebrow={<Link href={`/providers/${w.providerId}`} className="hover:text-primary">{w.providerName} · {w.providerKind === 'DOCKER_HOST' ? 'container' : 'task'}</Link>}
        title={<span className="font-mono text-[26px] md:text-[30px]">{w.name}</span>}
        meta={<><WorkloadPill value={w.status} /><span className="font-mono">{w.image}</span>{w.health && <span>health: <span className="font-mono text-foreground">{w.health}</span></span>}<span>observed <When v={w.observedAt} /></span></>}
      />
      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-4">
        <div className="space-y-4 min-w-0">
          <Panel title="Ports" count={w.ports.length} delay={40}>
            {!w.ports.length ? <div className="px-4 py-4 text-[13px] text-muted-foreground">No published or exposed ports.</div> : (
              <table className="w-full text-[13px]"><thead><tr className="eyebrow text-left border-b border-border"><th className="font-normal px-4 py-2">Container</th><th className="font-normal px-3">Host</th><th className="font-normal px-3">Bind</th><th className="font-normal px-4">Proto</th></tr></thead>
                <tbody className="divide-y divide-border">{w.ports.map((p, i) => (
                  <tr key={i} className="font-mono tnum"><td className="px-4 py-2 font-semibold">{p.containerPort}</td><td className="px-3">{p.hostPort ?? <span className="text-muted-foreground">unpublished</span>}</td><td className="px-3 text-muted-foreground">{p.hostIp ?? '0.0.0.0'}</td><td className="px-4 text-muted-foreground">{p.protocol.toLowerCase()}</td></tr>
                ))}</tbody></table>
            )}
          </Panel>
          <Panel title="Mounts" count={w.mounts.length} delay={80}>
            {!w.mounts.length ? <div className="px-4 py-4 text-[13px] text-muted-foreground">No mounts.</div> : (
              <ul className="divide-y divide-border">{w.mounts.map((m, i) => (
                <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                  <HardDrive className="size-3.5 mt-0.5 text-muted-foreground" />
                  <div className="min-w-0 flex-1 font-mono text-[12px]">
                    <div className="font-semibold break-all">{m.destination}</div>
                    <div className="text-muted-foreground break-all">{m.source ?? '(anonymous)'} · {m.type}</div>
                  </div>
                  {m.anonymous && <span className="text-[11px] text-[hsl(var(--warn))] max-w-[180px] text-right">anonymous: will not survive a recreate</span>}
                </li>
              ))}</ul>
            )}
          </Panel>
          <Panel title="Labels" count={labels.length} delay={120}>
            {!labels.length ? <div className="px-4 py-4 text-[13px] text-muted-foreground">No labels.</div> : (
              <div className="max-h-80 overflow-y-auto divide-y divide-border">{labels.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 px-4 py-1.5 font-mono text-[11.5px]"><span className="text-muted-foreground break-all">{k}</span><span className="break-all">{v}</span></div>
              ))}</div>
            )}
          </Panel>
        </div>
        <div className="space-y-4 min-w-0">
          <Panel title="Berth" delay={60}>
            {w.membership ? (
              <Link href={`/groups/${w.membership.groupId}`} className="block p-4 row-hover" data-testid="link-workload-group">
                <div className="flex items-center gap-2 mb-1"><Anchor className="size-4 text-primary" /><span className="font-mono text-[15px] font-semibold">{w.membership.groupName}</span><Pill value={w.membership.role} live={false} /></div>
                <div className="text-[12.5px] text-muted-foreground">Peers reach it as <span className="font-mono text-foreground">{w.membership.serviceName}</span></div>
              </Link>
            ) : <Empty icon={<Anchor className="size-5" />} title="Adrift" body="This workload has no berth. Add it to a group from that group's member list." className="py-8" />}
          </Panel>
          <Panel title="Identity" bodyClass="px-4 pb-1" delay={100}>
            <KV items={[
              ['External id', <span className="flex items-center gap-1 font-mono text-[11.5px] break-all">{w.externalId}<CopyButton text={w.externalId} /></span>],
              ['Restart', w.restartPolicy ? <span className="font-mono">{w.restartPolicy}</span> : null],
              ['Env hash', w.envHash ? <span className="font-mono text-[11.5px]">{w.envHash.slice(0, 16)}</span> : null],
              ['Networks', w.networks.length ? <span className="flex flex-wrap gap-1">{w.networks.map((n) => <span key={n} className="font-mono text-[11px] rounded-sm bg-accent text-accent-foreground px-1.5">{n}</span>)}</span> : null],
              ['First seen', <When v={w.firstSeenAt} abs />],
            ]} />
          </Panel>
          <Panel title="Command" delay={140}>
            <pre className={cn('font-mono text-[11.5px] p-4 whitespace-pre-wrap break-all', !w.command.length && 'text-muted-foreground')}>{w.command.length ? w.command.join(' ') : '(image default)'}</pre>
          </Panel>
          <Panel title="Runtime" bodyClass="px-4 pb-1" delay={180}>
            {Object.keys(w.runtime).length ? <KV items={Object.entries(w.runtime).map(([k, v]) => [k, <span className="font-mono text-[11.5px] break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>])} /> : <div className="py-3 text-[13px] text-muted-foreground">No runtime facts.</div>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
