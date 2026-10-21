import { useMemo, useState } from 'react';
import { Activity as ActivityIcon } from 'lucide-react';
import { useListEvents, useListGroups, useListProviders, type ActivityEvent } from '@workspace/api-client-react';
import { stamp } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Empty, ErrorBlock, PageHeader, Pager, Panel, RowsSkeleton } from '@/components/berth';
import { EventRow } from '@/components/feed';

export default function Activity() {
  const [providerId, setProviderId] = useState<string | undefined>();
  const [groupId, setGroupId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const { data: providers } = useListProviders({ pageSize: 200 });
  const { data: groups } = useListGroups({ pageSize: 200, providerId });
  const { data, isLoading, error, refetch } = useListEvents({ providerId, groupId, page, pageSize: 100 });
  const days = useMemo(() => {
    const out: { day: string; items: ActivityEvent[] }[] = [];
    data?.data.forEach((e) => {
      const d = stamp(e.at, 'EEEE, MMM d');
      const last = out[out.length - 1];
      if (last?.day === d) last.items.push(e);
      else out.push({ day: d, items: [e] });
    });
    return out;
  }, [data]);

  return (
    <div>
      <PageHeader eyebrow="Audit" title="Activity log" meta={<span>Everything that happened, newest first. Secret values are never recorded, only their keys.</span>} />
      <div className="flex flex-col md:flex-row gap-2 mb-4 rise">
        <Select value={providerId ?? 'all'} onValueChange={(v) => { setProviderId(v === 'all' ? undefined : v); setGroupId(undefined); setPage(1); }}>
          <SelectTrigger className="md:w-60 bg-card" data-testid="select-activity-provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {providers?.data.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={groupId ?? 'all'} onValueChange={(v) => { setGroupId(v === 'all' ? undefined : v); setPage(1); }}>
          <SelectTrigger className="md:w-60 bg-card" data-testid="select-activity-group"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All berths</SelectItem>
            {groups?.data.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Panel>
        {isLoading ? <RowsSkeleton rows={10} cols={3} /> : error ? <ErrorBlock error={error} onRetry={() => refetch()} className="m-4" /> : !data?.data.length ? (
          <Empty icon={<ActivityIcon className="size-5" />} title="The log is empty" body="Register a provider or create a berth and it will be written here." />
        ) : (
          days.map((d) => (
            <div key={d.day}>
              <div className="sticky top-14 md:top-0 z-10 bg-muted/90 backdrop-blur px-4 py-1.5 border-y border-border eyebrow">{d.day} · {d.items.length}</div>
              <ul className="divide-y divide-border">{d.items.map((e, i) => <EventRow key={e.id} e={e} i={i} />)}</ul>
            </div>
          ))
        )}
        {data && <Pager page={page} totalPages={data.pagination.totalPages} totalItems={data.pagination.totalItems} onPage={setPage} />}
      </Panel>
    </div>
  );
}
