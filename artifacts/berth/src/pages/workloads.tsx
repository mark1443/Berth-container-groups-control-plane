import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { Boxes, Search } from 'lucide-react';
import { useListProviders, useListWorkloads, type WorkloadStatus } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Empty, ErrorBlock, FilterChip, PageHeader, Pager, Panel, Pill, RowsSkeleton, When, WorkloadPill } from '@/components/berth';

export default function Workloads() {
  const search = useSearch();
  const initialProvider = new URLSearchParams(search).get('provider') ?? undefined;
  const [, nav] = useLocation();
  const [providerId, setProviderId] = useState<string | undefined>(initialProvider);
  const [status, setStatus] = useState<WorkloadStatus | undefined>();
  const [managed, setManaged] = useState<boolean | undefined>();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(t.current);
    t.current = setTimeout(() => { setTerm(q.trim()); setPage(1); }, 250);
    return () => clearTimeout(t.current);
  }, [q]);
  const { data: providers } = useListProviders({ pageSize: 200 });
  const { data, isLoading, error, refetch, isFetching } = useListWorkloads({ providerId, status, managed, search: term || undefined, page, pageSize: 50 });
  const reset = (f: () => void) => { f(); setPage(1); };

  return (
    <div>
      <PageHeader eyebrow="Inventory" title="Workloads" meta={<span>Every container and task Berth has observed. Adrift ones have no berth yet.</span>} />
      <div className="flex flex-col md:flex-row gap-2 mb-3 rise">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or image" className="pl-9 bg-card" data-testid="input-search-workloads" />
        </div>
        <Select value={providerId ?? 'all'} onValueChange={(v) => reset(() => setProviderId(v === 'all' ? undefined : v))}>
          <SelectTrigger className="md:w-56 bg-card" data-testid="select-filter-provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {providers?.data.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status ?? 'all'} onValueChange={(v) => reset(() => setStatus(v === 'all' ? undefined : (v as WorkloadStatus)))}>
          <SelectTrigger className="md:w-40 bg-card" data-testid="select-filter-status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {['RUNNING', 'STOPPED', 'MISSING', 'UNKNOWN'].map((s) => <SelectItem key={s} value={s}>{s.toLowerCase()}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Panel
        title={<div className="flex gap-1.5">
          <FilterChip active={managed === undefined} onClick={() => reset(() => setManaged(undefined))} testId="filter-managed-all">All</FilterChip>
          <FilterChip active={managed === true} onClick={() => reset(() => setManaged(true))} testId="filter-managed-true">Berthed</FilterChip>
          <FilterChip active={managed === false} onClick={() => reset(() => setManaged(false))} testId="filter-managed-false">Adrift</FilterChip>
        </div>}
        actions={isFetching && !isLoading ? <span className="font-mono text-[11px] text-muted-foreground">refreshing</span> : undefined}
      >
        {isLoading ? <RowsSkeleton rows={8} cols={6} /> : error ? <ErrorBlock error={error} onRetry={() => refetch()} className="m-4" /> : !data?.data.length ? (
          <Empty icon={<Boxes className="size-5" />} title={term || providerId || status || managed !== undefined ? 'Nothing matches these filters' : 'No workloads observed'} body={term ? `No workload name or image contains "${term}".` : 'Run discovery on a provider to take an inventory.'} action={!providerId && !term ? <Link href="/providers" className="text-[13px] text-primary font-medium" data-testid="link-go-providers">Go to providers</Link> : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left eyebrow border-b border-border">
                <th className="font-normal px-4 py-2">Name</th><th className="font-normal px-3">Status</th><th className="font-normal px-3">Provider</th><th className="font-normal px-3">Ports</th><th className="font-normal px-3">Berth</th><th className="font-normal px-4 text-right">Observed</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {data.data.map((w, i) => (
                  <tr key={w.id} className="row-hover cursor-pointer rise" style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }} onClick={() => nav(`/workloads/${w.id}`)} data-testid={`row-workload-${w.id}`}>
                    <td className="px-4 py-2.5 max-w-[320px]">
                      <div className="font-mono font-semibold truncate">{w.name}</div>
                      <div className="text-[11.5px] text-muted-foreground truncate">{w.image}</div>
                    </td>
                    <td className="px-3"><WorkloadPill value={w.status} /></td>
                    <td className="px-3 text-[12px]">{w.providerName}<div className="font-mono text-[10.5px] text-muted-foreground">{w.providerKind === 'DOCKER_HOST' ? 'docker' : 'ecs'}</div></td>
                    <td className="px-3">
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 max-w-[200px]">
                        {w.ports.length ? w.ports.slice(0, 3).map((p, j) => (
                          <span key={j} className="font-mono text-[11.5px] tnum">{p.hostPort ? <>{p.hostPort}<span className="text-muted-foreground">→</span></> : null}{p.containerPort}</span>
                        )) : <span className="text-muted-foreground text-[12px]">—</span>}
                        {w.ports.length > 3 && <span className="text-[11px] text-muted-foreground">+{w.ports.length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-3">
                      {w.membership ? (
                        <Link href={`/groups/${w.membership.groupId}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-2 hover:text-primary" data-testid={`link-membership-${w.id}`}>
                          <span className="font-mono text-[12px] font-semibold">{w.membership.groupName}</span>
                          <Pill value={w.membership.role} live={false} />
                        </Link>
                      ) : <span className="text-[11.5px] text-muted-foreground italic">adrift</span>}
                    </td>
                    <td className="px-4 text-right text-[12px] text-muted-foreground"><When v={w.observedAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={page} totalPages={data.pagination.totalPages} totalItems={data.pagination.totalItems} onPage={setPage} />}
      </Panel>
    </div>
  );
}

