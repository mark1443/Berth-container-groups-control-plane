import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ListTree } from 'lucide-react';
import { getListOperationsQueryKey, useListGroups, useListOperations, type OperationState } from '@workspace/api-client-react';
import { duration } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Empty, ErrorBlock, FilterChip, PageHeader, Pager, Panel, Pill, RowsSkeleton, When } from '@/components/berth';
import { OpProgress } from '@/components/operation-view';

const STATES: OperationState[] = ['RUNNING', 'PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'];

export default function Operations() {
  const [, nav] = useLocation();
  const [state, setState] = useState<OperationState | undefined>();
  const [groupId, setGroupId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const { data: groups } = useListGroups({ pageSize: 200 });
  const params = { state, groupId, page, pageSize: 50 };
  const { data, isLoading, error, refetch } = useListOperations(params, { query: { queryKey: getListOperationsQueryKey(params), refetchInterval: 5000 } });

  return (
    <div>
      <PageHeader eyebrow="Audit" title="Operations" meta={<span>Every apply, rollback and release, with who asked and why.</span>} />
      <div className="flex flex-wrap items-center gap-2 mb-4 rise">
        <FilterChip active={!state} onClick={() => { setState(undefined); setPage(1); }} testId="filter-op-all">All</FilterChip>
        {STATES.map((s) => <FilterChip key={s} active={state === s} onClick={() => { setState(s); setPage(1); }} testId={`filter-op-${s.toLowerCase()}`}>{s.toLowerCase()}</FilterChip>)}
        <Select value={groupId ?? 'all'} onValueChange={(v) => { setGroupId(v === 'all' ? undefined : v); setPage(1); }}>
          <SelectTrigger className="ml-auto w-56 h-8 bg-card" data-testid="select-op-group"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All berths</SelectItem>
            {groups?.data.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Panel>
        {isLoading ? <RowsSkeleton rows={8} cols={6} /> : error ? <ErrorBlock error={error} onRetry={() => refetch()} className="m-4" /> : !data?.data.length ? (
          <Empty icon={<ListTree className="size-5" />} title="No operations here" body="Operations appear when you apply a berth." action={<Link href="/groups" className="text-[13px] text-primary font-medium" data-testid="link-go-groups">Go to berths</Link>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left eyebrow border-b border-border">
                <th className="font-normal px-4 py-2">State</th><th className="font-normal px-3">Berth</th><th className="font-normal px-3">Kind</th><th className="font-normal px-3 w-40">Progress</th><th className="font-normal px-3">Reason</th><th className="font-normal px-3">By</th><th className="font-normal px-3 text-right">Took</th><th className="font-normal px-4 text-right">When</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {data.data.map((o, i) => (
                  <tr key={o.id} className="row-hover cursor-pointer rise" style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }} onClick={() => nav(`/operations/${o.id}`)} data-testid={`row-operation-${o.id}`}>
                    <td className="px-4 py-2.5"><Pill value={o.state} /></td>
                    <td className="px-3 font-mono font-semibold">{o.groupName}</td>
                    <td className="px-3 font-mono text-[11.5px] text-muted-foreground">{o.kind}</td>
                    <td className="px-3"><OpProgress op={o} /><div className="font-mono text-[10px] text-muted-foreground mt-1">{o.steps.filter((s) => s.state === 'SUCCEEDED').length}/{o.steps.length} steps</div></td>
                    <td className="px-3 max-w-[260px] truncate">{o.error ? <span className="text-destructive">{o.error}</span> : o.reason ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 text-[12px] text-muted-foreground">{o.createdBy ?? 'system'}</td>
                    <td className="px-3 text-right font-mono text-[11.5px] tnum">{duration(o.startedAt, o.finishedAt)}</td>
                    <td className="px-4 text-right text-[12px] text-muted-foreground"><When v={o.createdAt} /></td>
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
