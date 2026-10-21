import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Cloud, Pencil, Plug, Radar, Server, Trash2, X } from 'lucide-react';
import {
  getGetOverviewQueryKey, getGetProviderPortUsageQueryKey, getGetProviderQueryKey, getListEventsQueryKey, getListProvidersQueryKey, getListWorkloadsQueryKey,
  useCheckProviderConnectivity, useDeleteProvider, useGetProvider, useGetProviderPortUsage, useListEvents, useListGroups, useListWorkloads,
  type ConnectivityReport, type DiscoveryResult, type PortUsageEntry,
} from '@workspace/api-client-react';
import { errCode, errMsg, stamp } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { CopyButton, Empty, ErrorBlock, KV, PageHeader, Panel, Pill, PortTag, RowsSkeleton, When, WorkloadPill } from '@/components/berth';
import { EventRow } from '@/components/feed';
import { ProviderFormDialog } from '@/components/provider-form';
import { useRunProviderDiscovery } from '@workspace/api-client-react';

function PortMap({ providerId }: { providerId: string }) {
  const { data, isLoading, error, refetch } = useGetProviderPortUsage(providerId, { query: { enabled: !!providerId, queryKey: getGetProviderPortUsageQueryKey(providerId) } });
  const [, nav] = useLocation();
  const cells = useMemo(() => {
    if (!data) return [];
    const span = data.rangeEnd - data.rangeStart + 1;
    const n = Math.min(span, 200);
    const per = span / n;
    const out: { from: number; to: number; entries: PortUsageEntry[] }[] = [];
    for (let i = 0; i < n; i++) {
      const from = Math.floor(data.rangeStart + i * per);
      const to = Math.floor(data.rangeStart + (i + 1) * per) - 1;
      out.push({ from, to: Math.max(to, from), entries: data.used.filter((u) => u.hostPort >= from && u.hostPort <= Math.max(to, from)) });
    }
    return out;
  }, [data]);
  const outside = data?.used.filter((u) => u.hostPort < data.rangeStart || u.hostPort > data.rangeEnd) ?? [];
  return (
    <Panel title="Host-port ledger" count={data ? `${data.used.length} used · ${data.freeInRange} free in range` : undefined} delay={80}>
      {isLoading ? <div className="p-4"><Skeleton className="h-16 w-full" /></div> : error ? <ErrorBlock error={error} onRetry={() => refetch()} className="m-4" /> : data && (
        <>
          <div className="p-4">
            <div className="flex justify-between font-mono text-[10.5px] text-muted-foreground mb-1.5"><span>{data.rangeStart}</span><span>allocation range</span><span>{data.rangeEnd}</span></div>
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(40, minmax(0, 1fr))' }}>
              {cells.map((c, i) => {
                const berth = c.entries.some((e) => e.owner === 'BERTH');
                const un = c.entries.some((e) => e.owner === 'UNMANAGED');
                return (
                  <Tooltip key={i}>
                    <TooltipTrigger asChild>
                      <div className={cn('h-4 rounded-[2px] transition-transform hover:scale-125', berth && un ? 'bg-[hsl(var(--bad))]' : berth ? 'bg-primary' : un ? 'bg-[hsl(var(--idle))]' : 'bg-muted')} />
                    </TooltipTrigger>
                    <TooltipContent className="font-mono text-[11px]">
                      {c.from === c.to ? c.from : `${c.from}–${c.to}`}: {c.entries.length ? c.entries.map((e) => `${e.hostPort} ${e.groupName ?? e.workloadName ?? e.owner.toLowerCase()}`).join(', ') : 'free'}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
            <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" /> Berth</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[hsl(var(--idle))]" /> Unmanaged</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-muted border border-border" /> Free</span>
              {outside.length > 0 && <span className="ml-auto font-mono">{outside.length} outside range</span>}
            </div>
          </div>
          {data.used.length > 0 && (
            <div className="border-t border-card-border max-h-72 overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <tbody className="divide-y divide-border">
                  {[...data.used].sort((a, b) => a.hostPort - b.hostPort).map((u) => (
                    <tr key={`${u.hostPort}-${u.protocol}`} className="row-hover cursor-pointer" onClick={() => u.groupId ? nav(`/groups/${u.groupId}`) : u.workloadId && nav(`/workloads/${u.workloadId}`)} data-testid={`row-port-${u.hostPort}`}>
                      <td className="px-4 py-1.5 w-24"><PortTag port={u.hostPort} proto={u.protocol} /></td>
                      <td className="px-2"><Pill value={u.owner} live={false} /></td>
                      <td className="px-2 font-mono">{u.groupName ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 font-mono text-muted-foreground truncate">{u.workloadName ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function Report({ r, onClose }: { r: ConnectivityReport; onClose: () => void }) {
  return (
    <div className={cn('rounded-md border p-4 mb-4 pop', r.ok ? 'border-[hsl(var(--ok)/.35)] bg-[hsl(var(--ok)/.06)]' : 'border-destructive/35 bg-destructive/5')} data-testid="panel-connectivity">
      <div className="flex items-center gap-3">
        {r.ok ? <Check className="size-4 text-[hsl(var(--ok))]" /> : <X className="size-4 text-destructive" />}
        <span className="text-[13px] font-semibold">{r.message}</span>
        <Pill value={r.status} />
        {r.latencyMs != null && <span className="font-mono text-[11.5px] text-muted-foreground">{r.latencyMs}ms</span>}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">{stamp(r.checkedAt, 'HH:mm:ss')}</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>
      {Object.keys(r.details).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(r.details).map(([k, v]) => <span key={k} className="font-mono text-[11px] rounded-sm bg-card border border-border px-2 py-0.5"><span className="text-muted-foreground">{k}</span> {String(v)}</span>)}
        </div>
      )}
    </div>
  );
}

export default function ProviderDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: p, isLoading, error, refetch } = useGetProvider(id, { query: { enabled: !!id, queryKey: getGetProviderQueryKey(id) } });
  const check = useCheckProviderConnectivity();
  const discover = useRunProviderDiscovery();
  const del = useDeleteProvider();
  const [report, setReport] = useState<ConnectivityReport | null>(null);
  const [disc, setDisc] = useState<DiscoveryResult | null>(null);
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const wl = useListWorkloads({ providerId: id, pageSize: 12 });
  const groups = useListGroups({ providerId: id, pageSize: 50 });
  const ev = useListEvents({ providerId: id, pageSize: 10 });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (error || !p) return <ErrorBlock error={error} onRetry={() => refetch()} />;

  const runCheck = () => check.mutate({ id }, {
    onSuccess: (r) => { setReport(r); qc.invalidateQueries({ queryKey: getGetProviderQueryKey(id) }); qc.invalidateQueries({ queryKey: getListProvidersQueryKey() }); toast({ title: r.ok ? 'Provider reachable' : 'Connectivity problem', description: r.message, variant: r.ok ? undefined : 'destructive' }); },
    onError: (e) => toast({ title: 'Check failed', description: errMsg(e), variant: 'destructive' }),
  });
  const runDisc = () => discover.mutate({ id }, {
    onSuccess: (r) => {
      setDisc(r);
      [getGetProviderQueryKey(id), getListWorkloadsQueryKey(), getGetProviderPortUsageQueryKey(id), getListEventsQueryKey(), getGetOverviewQueryKey()].forEach((k) => qc.invalidateQueries({ queryKey: k }));
      toast({ title: `Discovery observed ${r.observedCount} workloads`, description: r.message });
    },
    onError: (e) => toast({ title: 'Discovery failed', description: errMsg(e), variant: 'destructive' }),
  });
  const remove = () => del.mutate({ id }, {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListProvidersQueryKey() }); qc.invalidateQueries({ queryKey: getGetOverviewQueryKey() }); toast({ title: `${p.name} removed` }); nav('/providers'); },
    onError: (e) => { setConfirm(false); toast({ title: errCode(e) === 'PROVIDER_HAS_GROUPS' ? 'Provider still hosts berths' : 'Could not remove', description: errMsg(e), variant: 'destructive' }); },
  });
  const docker = p.kind === 'DOCKER_HOST';

  return (
    <div>
      <Link href="/providers" className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground mb-3" data-testid="link-back-providers"><ArrowLeft className="size-3.5" /> Providers</Link>
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5">{docker ? <Server className="size-3" /> : <Cloud className="size-3" />}{docker ? 'Docker host' : 'ECS cluster'}</span>}
        title={p.name}
        meta={<><Pill value={p.status} /><span>last seen {p.lastSeenAt ? <When v={p.lastSeenAt} /> : 'never'}</span><span className="font-mono">{p.workloadCount} workloads · {p.groupCount} berths</span></>}
        actions={<>
          <Button variant="outline" onClick={runCheck} disabled={check.isPending} className={cn(check.isPending && 'sweep')} data-testid="button-check-connectivity"><Plug /> {check.isPending ? 'Checking' : 'Check connectivity'}</Button>
          <Button variant="outline" onClick={runDisc} disabled={discover.isPending} className={cn(discover.isPending && 'sweep')} data-testid="button-run-discovery"><Radar /> {discover.isPending ? 'Discovering' : 'Run discovery'}</Button>
          <Button variant="outline" onClick={() => setEdit(true)} data-testid="button-edit-provider"><Pencil /> Edit</Button>
          <Button variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => setConfirm(true)} data-testid="button-delete-provider"><Trash2 /></Button>
        </>}
      />
      {p.lastError && <div className="mb-4 rounded-sm border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">{p.lastError}</div>}
      {report && <Report r={report} onClose={() => setReport(null)} />}
      {disc && (
        <div className="mb-4 rounded-md border border-[hsl(var(--busy)/.3)] bg-[hsl(var(--busy)/.05)] px-4 py-3 flex flex-wrap items-center gap-3 text-[13px] pop" data-testid="panel-discovery">
          <Radar className="size-4 text-[hsl(var(--busy))]" />
          <span className="font-semibold">{disc.observedCount} workloads observed</span>
          <span className="text-muted-foreground">{disc.message}</span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">{stamp(disc.startedAt, 'HH:mm:ss')} → {stamp(disc.finishedAt, 'HH:mm:ss')}</span>
          <button onClick={() => setDisc(null)} className="text-muted-foreground"><X className="size-3.5" /></button>
        </div>
      )}
      <div className="grid lg:grid-cols-[1fr_1.3fr] gap-4">
        <div className="space-y-4 min-w-0">
          <Panel title="Settings" bodyClass="px-4 pb-1" delay={40}>
            <KV items={docker ? [
              ['Transport', <span className="font-mono">{p.settings.transport}</span>],
              ['Endpoint', <span className="font-mono">{p.settings.sshUser && p.settings.transport === 'SSH' ? `${p.settings.sshUser}@` : ''}{p.settings.host}:{p.settings.port}</span>],
              ['Port range', <span className="font-mono">{p.settings.portRangeStart}–{p.settings.portRangeEnd}</span>],
            ] : [
              ['Region', <span className="font-mono">{p.settings.region}</span>],
              ['Cluster', <span className="font-mono text-[12px] break-all">{p.settings.clusterArn}</span>],
              ['VPC', <span className="font-mono">{p.settings.vpcId}</span>],
              ['Port range', <span className="font-mono">{p.settings.portRangeStart}–{p.settings.portRangeEnd}</span>],
            ]} />
          </Panel>
          <Panel title="Capabilities" bodyClass="p-4" delay={60}>
            <div className="grid grid-cols-2 gap-2">
              {([['canChooseHostPort', 'Chooses host ports'], ['canRecreateInPlace', 'Recreates in place'], ['supportsNativeSecrets', 'Native secrets'], ['supportsEvents', 'Event stream']] as const).map(([k, l]) => (
                <div key={k} className={cn('flex items-center gap-2 text-[12.5px] rounded-sm border px-2.5 py-1.5', p.capabilities[k] ? 'border-[hsl(var(--ok)/.3)]' : 'border-border text-muted-foreground')}>
                  {p.capabilities[k] ? <Check className="size-3.5 text-[hsl(var(--ok))]" /> : <X className="size-3.5" />}{l}
                </div>
              ))}
            </div>
            <div className="mt-3 font-mono text-[11.5px] text-muted-foreground">service discovery: <span className="text-foreground">{p.capabilities.serviceDiscovery}</span></div>
          </Panel>
          <Panel title="Credential" bodyClass="px-4 pb-3" delay={80}>
            {p.credential ? (
              <>
                <KV items={[
                  ['Kind', <span className="font-mono">{p.credential.kind}</span>],
                  ['Key version', <span className="font-mono">v{p.credential.keyVersion}</span>],
                  ['Fingerprint', p.credential.fingerprint ? <span className="font-mono text-[12px] break-all">{p.credential.fingerprint}</span> : null],
                  ['Rotated', <When v={p.credential.updatedAt} />],
                ]} />
                {p.credential.publicKey && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1"><span className="eyebrow">for authorized_keys</span><CopyButton text={p.credential.publicKey} /></div>
                    <pre className="font-mono text-[10.5px] bg-muted rounded-sm p-2.5 whitespace-pre-wrap break-all max-h-24 overflow-y-auto" data-testid="text-public-key">{p.credential.publicKey}</pre>
                  </div>
                )}
                <div className="mt-2 text-[11px] text-muted-foreground">Private material is stored encrypted and never returned.</div>
              </>
            ) : <div className="py-3 text-[13px] text-muted-foreground">No credential stored.</div>}
          </Panel>
        </div>
        <div className="space-y-4 min-w-0">
          <PortMap providerId={id} />
          <Panel title="Berths here" count={groups.data?.pagination.totalItems} delay={100}>
            {groups.isLoading ? <RowsSkeleton rows={2} cols={3} /> : !groups.data?.data.length ? <div className="px-4 py-4 text-[13px] text-muted-foreground">No berths on this provider.</div> : (
              <ul className="divide-y divide-border">{groups.data.data.map((g) => (
                <li key={g.id}><Link href={`/groups/${g.id}`} className="flex items-center gap-3 px-4 py-2 row-hover" data-testid={`link-group-${g.id}`}><span className="font-mono text-[13px] font-semibold">{g.name}</span><Pill value={g.status} /><span className="text-[12px] text-muted-foreground">{g.memberCount} members</span><PortTag port={g.entryPort} proto={g.protocol} className="ml-auto" /></Link></li>
              ))}</ul>
            )}
          </Panel>
          <Panel title="Workloads" count={wl.data?.pagination.totalItems} delay={120} actions={<Link href={`/workloads?provider=${id}`} className="text-[12px] text-muted-foreground hover:text-primary" data-testid="link-provider-workloads">View all</Link>}>
            {wl.isLoading ? <RowsSkeleton rows={4} cols={3} /> : !wl.data?.data.length ? <Empty icon={<Radar className="size-5" />} title="Nothing discovered yet" body="Run discovery to take an inventory." className="py-8" /> : (
              <ul className="divide-y divide-border">{wl.data.data.map((w) => (
                <li key={w.id}><Link href={`/workloads/${w.id}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2 row-hover" data-testid={`link-workload-${w.id}`}>
                  <span className="min-w-0"><span className="font-mono text-[12.5px] font-semibold">{w.name}</span> <span className="text-[11.5px] text-muted-foreground truncate">{w.image}</span></span>
                  {w.membership ? <span className="font-mono text-[11px] text-primary">{w.membership.groupName}</span> : <span className="text-[11px] text-muted-foreground">adrift</span>}
                  <WorkloadPill value={w.status} />
                </Link></li>
              ))}</ul>
            )}
          </Panel>
          <Panel title="Provider activity" delay={140}>
            {ev.isLoading ? <RowsSkeleton rows={3} cols={2} /> : !ev.data?.data.length ? <div className="px-4 py-4 text-[13px] text-muted-foreground">No events yet.</div> : <ul className="divide-y divide-border">{ev.data.data.map((e, i) => <EventRow key={e.id} e={e} i={i} compact />)}</ul>}
          </Panel>
        </div>
      </div>
      {edit && <ProviderFormDialog open={edit} onOpenChange={setEdit} provider={p} />}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Remove {p.name}?</AlertDialogTitle>
            <AlertDialogDescription>Berth forgets this provider, its credential and its inventory. Containers keep running. Providers that still host berths cannot be removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Keep</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={(e) => { e.preventDefault(); remove(); }} disabled={del.isPending} data-testid="button-confirm-delete">{del.isPending ? 'Removing' : 'Remove provider'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
