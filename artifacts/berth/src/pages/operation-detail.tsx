import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { getGetGroupQueryKey, getGetOverviewQueryKey, getListOperationsQueryKey } from '@workspace/api-client-react';
import { duration, LIVE } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { CopyButton, ErrorBlock, KV, PageHeader, Panel, Pill, When } from '@/components/berth';
import { OpProgress, StepTimeline, useLiveOperation } from '@/components/operation-view';

export default function OperationDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: op, isLoading, error, refetch } = useLiveOperation(id, (o) => {
    qc.invalidateQueries({ queryKey: getGetGroupQueryKey(o.groupId) });
    qc.invalidateQueries({ queryKey: getListOperationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
  });
  if (isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-80" /><Skeleton className="h-72 w-full" /></div>;
  if (error || !op) return <ErrorBlock error={error} onRetry={() => refetch()} />;
  const live = LIVE.has(op.state);
  return (
    <div>
      <Link href="/operations" className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground mb-3" data-testid="link-back-operations"><ArrowLeft className="size-3.5" /> Operations</Link>
      <PageHeader
        eyebrow={<>{op.kind} operation{live && <span className="ml-2 text-primary">· following live, every 2s</span>}</>}
        title={<span className="font-mono">op/{op.id.slice(0, 8)}</span>}
        meta={<><Pill value={op.state} /><Link href={`/groups/${op.groupId}`} className="font-mono text-foreground hover:text-primary" data-testid="link-op-group">{op.groupName}</Link><span>{op.reason ?? 'No reason given'}</span></>}
      />
      <div className="mb-4 rise"><OpProgress op={op} /></div>
      {op.error && <div className="mb-4 rounded-sm border-l-2 border-destructive bg-destructive/5 px-3 py-2.5 text-[13px] text-destructive" data-testid="text-op-error">{op.error}</div>}
      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-4">
        <Panel title="Step timeline" count={`${op.steps.length} steps`}>
          <StepTimeline steps={op.steps} />
        </Panel>
        <Panel title="Record" bodyClass="px-4 pb-1" delay={60}>
          <KV items={[
            ['Operation', <span className="flex items-center gap-1 font-mono text-[11.5px] break-all">{op.id}<CopyButton text={op.id} /></span>],
            ['Idempotency key', <span className="flex items-center gap-1 font-mono text-[11.5px] break-all">{op.idempotencyKey}<CopyButton text={op.idempotencyKey} /></span>],
            ['Requested by', op.createdBy ?? 'system'],
            ['Created', <When v={op.createdAt} abs />],
            ['Started', op.startedAt ? <When v={op.startedAt} abs /> : null],
            ['Finished', op.finishedAt ? <When v={op.finishedAt} abs /> : null],
            ['Duration', <span className="font-mono">{duration(op.startedAt, op.finishedAt ?? (live ? new Date() : null))}</span>],
          ]} />
        </Panel>
      </div>
    </div>
  );
}
