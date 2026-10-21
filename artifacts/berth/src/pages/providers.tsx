import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Cloud, Plus, Server } from 'lucide-react';
import { useListProviders, type ProviderKind } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Empty, ErrorBlock, FilterChip, PageHeader, Pager, Panel, Pill, RowsSkeleton, When } from '@/components/berth';
import { ProviderFormDialog } from '@/components/provider-form';

export default function Providers() {
  const [kind, setKind] = useState<ProviderKind | undefined>();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [, nav] = useLocation();
  const { data, isLoading, error, refetch } = useListProviders({ kind, page, pageSize: 50 });

  return (
    <div>
      <PageHeader
        eyebrow="Infrastructure"
        title="Providers"
        meta={<span>Docker hosts and ECS clusters Berth can see and steer.</span>}
        actions={<Button onClick={() => setOpen(true)} data-testid="button-register-provider"><Plus /> Register provider</Button>}
      />
      <Panel
        title={
          <div className="flex gap-1.5">
            <FilterChip active={!kind} onClick={() => { setKind(undefined); setPage(1); }} testId="filter-kind-all">All</FilterChip>
            <FilterChip active={kind === 'DOCKER_HOST'} onClick={() => { setKind('DOCKER_HOST'); setPage(1); }} testId="filter-kind-docker">Docker hosts</FilterChip>
            <FilterChip active={kind === 'ECS_CLUSTER'} onClick={() => { setKind('ECS_CLUSTER'); setPage(1); }} testId="filter-kind-ecs">ECS clusters</FilterChip>
          </div>
        }
      >
        {isLoading ? <RowsSkeleton /> : error ? <ErrorBlock error={error} onRetry={() => refetch()} className="m-4" /> : !data?.data.length ? (
          <Empty icon={<Server className="size-5" />} title="No providers registered" body="Register a Docker host over SSH or TLS, or an ECS cluster, and Berth will start discovering what runs there." action={<Button onClick={() => setOpen(true)} data-testid="button-register-empty"><Plus /> Register provider</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left eyebrow border-b border-border">
                  <th className="font-normal px-4 py-2">Provider</th><th className="font-normal px-3">Status</th><th className="font-normal px-3">Endpoint</th>
                  <th className="font-normal px-3 text-right">Workloads</th><th className="font-normal px-3 text-right">Berths</th><th className="font-normal px-3">Port range</th><th className="font-normal px-4 text-right">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.data.map((p, i) => (
                  <tr key={p.id} className="row-hover cursor-pointer rise" style={{ animationDelay: `${i * 25}ms` }} onClick={() => nav(`/providers/${p.id}`)} data-testid={`row-provider-${p.id}`}>
                    <td className="px-4 py-3">
                      <Link href={`/providers/${p.id}`} className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                        <span className="grid place-items-center size-7 rounded bg-accent text-accent-foreground">{p.kind === 'DOCKER_HOST' ? <Server className="size-3.5" /> : <Cloud className="size-3.5" />}</span>
                        <span>
                          <span className="block font-semibold">{p.name}</span>
                          <span className="block text-[11px] text-muted-foreground font-mono">{p.kind === 'DOCKER_HOST' ? `docker · ${p.settings.transport?.toLowerCase() ?? 'ssh'}` : `ecs · ${p.settings.region ?? ''}`}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3"><Pill value={p.status} />{p.lastError && <div className="text-[11px] text-destructive mt-1 max-w-[200px] truncate" title={p.lastError}>{p.lastError}</div>}</td>
                    <td className="px-3 font-mono text-[12px] text-muted-foreground max-w-[240px] truncate">{p.kind === 'DOCKER_HOST' ? `${p.settings.sshUser ? `${p.settings.sshUser}@` : ''}${p.settings.host ?? '?'}:${p.settings.port ?? ''}` : p.settings.clusterArn?.split('/').pop() ?? '—'}</td>
                    <td className="px-3 text-right font-mono tnum">{p.workloadCount}</td>
                    <td className="px-3 text-right font-mono tnum">{p.groupCount}</td>
                    <td className="px-3 font-mono text-[12px] tnum">{p.settings.portRangeStart ?? '—'}–{p.settings.portRangeEnd ?? '—'}</td>
                    <td className="px-4 text-right text-[12px] text-muted-foreground">{p.lastSeenAt ? <When v={p.lastSeenAt} /> : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={page} totalPages={data.pagination.totalPages} totalItems={data.pagination.totalItems} onPage={setPage} />}
      </Panel>
      {open && <ProviderFormDialog open={open} onOpenChange={setOpen} onCreated={(p) => nav(`/providers/${p.id}`)} />}
    </div>
  );
}
