import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Anchor, Plus } from 'lucide-react';
import { useListGroups, useListProviders, type GroupStatus } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { toneOf } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, ErrorBlock, FilterChip, PageHeader, Pager, Pill, PortTag, When } from '@/components/berth';
import { CreateGroupDialog } from '@/components/group-forms';

const STATUSES: GroupStatus[] = ['APPLIED', 'DRIFTED', 'FAILED', 'APPLYING', 'DRAFT'];

export default function Groups() {
  const [, nav] = useLocation();
  const [status, setStatus] = useState<GroupStatus | undefined>();
  const [providerId, setProviderId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const { data: providers } = useListProviders({ pageSize: 200 });
  const { data, isLoading, error, refetch } = useListGroups({ status, providerId, page, pageSize: 50 });

  return (
    <div>
      <PageHeader
        eyebrow="Groups"
        title="Berths"
        meta={<span>Named groups of containers behind one entry port, wired to each other by service name.</span>}
        actions={<Button onClick={() => setOpen(true)} data-testid="button-create-group"><Plus /> New berth</Button>}
      />
      <div className="flex flex-wrap items-center gap-2 mb-4 rise">
        <FilterChip active={!status} onClick={() => { setStatus(undefined); setPage(1); }} testId="filter-status-all">All</FilterChip>
        {STATUSES.map((s) => <FilterChip key={s} active={status === s} onClick={() => { setStatus(s); setPage(1); }} testId={`filter-status-${s.toLowerCase()}`}>{s.toLowerCase()}</FilterChip>)}
        <Select value={providerId ?? 'all'} onValueChange={(v) => { setProviderId(v === 'all' ? undefined : v); setPage(1); }}>
          <SelectTrigger className="ml-auto w-56 h-8 bg-card" data-testid="select-groups-provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {providers?.data.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : error ? <ErrorBlock error={error} onRetry={() => refetch()} /> : !data?.data.length ? (
        <div className="rounded-md border border-card-border bg-card">
          <Empty icon={<Anchor className="size-5" />} title={status || providerId ? 'No berths match' : 'No berths yet'} body="A berth gathers containers on one provider, gives them a single entry port and injects SVC_* variables so they can find each other." action={<Button onClick={() => setOpen(true)} data-testid="button-create-group-empty"><Plus /> Create the first berth</Button>} />
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {data.data.map((g, i) => (
              <Link key={g.id} href={`/groups/${g.id}`} data-testid={`card-group-${g.id}`} className={cn('group relative block rounded-md border border-card-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-foreground/20 rise overflow-hidden', `tone-${toneOf(g.status)}`)} style={{ animationDelay: `${i * 35}ms` }}>
                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[hsl(var(--t))]" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[15px] font-semibold truncate group-hover:text-primary transition-colors">{g.name}</div>
                    <div className="text-[12px] text-muted-foreground truncate">{g.providerName}</div>
                  </div>
                  <Pill value={g.status} />
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <div className="eyebrow">entry</div>
                    <PortTag port={g.entryPort} proto={g.protocol} className="text-[20px] [&>span:nth-child(2)]:font-display" />
                  </div>
                  <div className="text-right">
                    <div className="font-display text-[22px] font-bold leading-none tnum">{g.memberCount}</div>
                    <div className="eyebrow">members</div>
                  </div>
                </div>
                <p className="mt-3 text-[12px] text-muted-foreground line-clamp-1 min-h-[18px]">{g.driftReasons[0] ?? g.description ?? '\u00a0'}</p>
                <div className="mt-2 pt-2 border-t border-border flex justify-between text-[11px] text-muted-foreground">
                  <span className="font-mono">{g.injectionPrefix}* · v{g.injectionVersion}</span>
                  <span>{g.lastAppliedAt ? <>applied <When v={g.lastAppliedAt} /></> : 'never applied'}</span>
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-4 rounded-md border border-card-border bg-card"><Pager page={page} totalPages={data.pagination.totalPages} totalItems={data.pagination.totalItems} onPage={setPage} /></div>
        </>
      )}
      {open && <CreateGroupDialog open={open} onOpenChange={setOpen} onCreated={(g) => nav(`/groups/${g.id}`)} presetProviderId={providerId} />}
    </div>
  );
}
