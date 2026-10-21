import { useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Eye, Lock, Pencil, Play, Plus, RefreshCw, Ship, Trash2, Waves } from 'lucide-react';
import {
  createGroupApply, getGetGroupConfigQueryKey, getGetGroupPlanQueryKey, getGetGroupQueryKey, getGetMemberConfigQueryKey, getGetMemberEnvQueryKey,
  getGetOverviewQueryKey, getListGroupPortsQueryKey, getListGroupsQueryKey, getListOperationsQueryKey, getListWorkloadsQueryKey,
  useDeleteGroup, useGetGroup, useGetGroupConfig, useGetGroupPlan, useGetMemberConfig, useGetMemberEnv, useListEvents, useListGroupPorts, useListOperations,
  usePatchGroupConfig, usePatchMemberConfig, useRemoveGroupMember,
  type ApplyPlan, type ConfigPatch, type GroupDetail, type GroupMember, type Operation,
} from '@workspace/api-client-react';
import { duration, errCode, errMsg, label, stamp } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Empty, ErrorBlock, PageHeader, Panel, Pill, PortTag, RowsSkeleton, When, WorkloadPill } from '@/components/berth';
import { ConfigEditor } from '@/components/config-editor';
import { EventRow } from '@/components/feed';
import { EditGroupDialog, invalidateGroup, MemberDialog } from '@/components/group-forms';
import { LiveOperationCard } from '@/components/operation-view';

/* ---------- Members ---------- */
function Members({ g }: { g: GroupDetail }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const remove = useRemoveGroupMember();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<GroupMember | null>(null);
  const [removing, setRemoving] = useState<GroupMember | null>(null);
  const order = { ENTRY: 0, EXPOSED: 1, INTERNAL: 2 };
  const members = [...g.members].sort((a, b) => order[a.role] - order[b.role] || a.serviceName.localeCompare(b.serviceName));
  return (
    <Panel title="Members" count={g.members.length} actions={<Button size="sm" onClick={() => setAdding(true)} data-testid="button-add-member"><Plus /> Add member</Button>}>
      {!members.length ? (
        <Empty icon={<Ship className="size-5" />} title="An empty berth" body={`Add workloads from ${g.providerName}. One of them must take the ENTRY role and own :${g.entryPort}.`} action={<Button size="sm" onClick={() => setAdding(true)} data-testid="button-add-member-empty"><Plus /> Add the first member</Button>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left eyebrow border-b border-border">
              <th className="font-normal px-4 py-2">Service</th><th className="font-normal px-3">Role</th><th className="font-normal px-3">Ports</th><th className="font-normal px-3">Workload</th><th className="font-normal px-3">Health check</th><th className="px-4" />
            </tr></thead>
            <tbody className="divide-y divide-border">
              {members.map((m, i) => (
                <tr key={m.id} className={cn('group row-hover rise', remove.isPending && removing?.id === m.id && 'opacity-40')} style={{ animationDelay: `${i * 30}ms` }} data-testid={`row-member-${m.id}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-mono font-semibold">{m.serviceName}</div>
                    <div className="font-mono text-[10.5px] text-muted-foreground">{g.injectionPrefix}{m.serviceName.toUpperCase().replace(/-/g, '_')}_HOST</div>
                  </td>
                  <td className="px-3"><Pill value={m.role} live={false} /></td>
                  <td className="px-3 font-mono text-[12px] tnum whitespace-nowrap">
                    {m.hostPort != null ? <>{m.hostPort}<span className="text-muted-foreground"> → </span></> : <span className="text-muted-foreground">internal → </span>}{m.containerPort}
                  </td>
                  <td className="px-3 max-w-[260px]">
                    <Link href={`/workloads/${m.workloadId}`} className="block hover:text-primary" data-testid={`link-member-workload-${m.id}`}>
                      <div className="flex items-center gap-2"><span className="font-mono text-[12px] truncate">{m.workloadName}</span><WorkloadPill value={m.workloadStatus} /></div>
                      <div className="text-[11px] text-muted-foreground truncate">{m.workloadImage}</div>
                    </Link>
                  </td>
                  <td className="px-3 font-mono text-[11.5px] text-muted-foreground">{m.healthCheck ? `${m.healthCheck.kind}${m.healthCheck.path ? ` ${m.healthCheck.path}` : ''}${m.healthCheck.timeoutSeconds ? ` · ${m.healthCheck.timeoutSeconds}s` : ''}` : '—'}</td>
                  <td className="px-4 text-right whitespace-nowrap">
                    <span className="md:opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditing(m)} data-testid={`button-edit-member-${m.id}`}><Pencil /></Button>
                      <Button size="icon" variant="ghost" className="size-7 hover:text-destructive" onClick={() => setRemoving(m)} data-testid={`button-remove-member-${m.id}`}><Trash2 /></Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <MemberDialog open={adding} onOpenChange={setAdding} group={g} />}
      {editing && <MemberDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} group={g} member={editing} />}
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Unberth {removing?.serviceName}?</AlertDialogTitle>
            <AlertDialogDescription>The workload goes back to adrift. Its allocated port is released and peers lose its SVC_* variables on the next apply.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" data-testid="button-confirm-remove-member" onClick={() => {
              const m = removing;
              if (!m) return;
              remove.mutate({ id: g.id, memberId: m.id }, {
                onSuccess: () => { invalidateGroup(qc, g.id); toast({ title: `${m.serviceName} removed`, description: 'Apply to carry it out on the host.' }); setRemoving(null); },
                onError: (e) => { toast({ title: 'Could not remove member', description: errMsg(e), variant: 'destructive' }); setRemoving(null); },
              });
            }}>Remove member</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

/* ---------- Plan ---------- */
const STEP_TONE: Record<string, string> = { ENSURE_NETWORK: 'busy', APPLY_MEMBER: 'brand', OPEN_INGRESS: 'ok', RELEASE_PORT: 'warn', RELEASE_NETWORK: 'warn' };
function PlanView({ plan }: { plan: ApplyPlan }) {
  return (
    <div>
      {plan.blockers.length > 0 && (
        <div className="m-4 mb-0 rounded-sm border-l-2 border-destructive bg-destructive/5 px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-destructive"><Ban className="size-3.5" /> Cannot apply yet</div>
          <ul className="mt-1 space-y-0.5 text-[12.5px]">{plan.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {plan.warnings.length > 0 && (
        <div className="m-4 mb-0 rounded-sm border-l-2 border-[hsl(var(--warn))] bg-[hsl(var(--warn)/.06)] px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[hsl(var(--warn))]"><AlertTriangle className="size-3.5" /> Warnings</div>
          <ul className="mt-1 space-y-0.5 text-[12.5px]">{plan.warnings.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {plan.isNoop ? (
        <div className="flex items-center gap-3 px-4 py-6"><CheckCircle2 className="size-5 text-[hsl(var(--ok))]" /><div><div className="text-[13.5px] font-semibold">In sync</div><div className="text-[12.5px] text-muted-foreground">What is running already matches this berth. Applying would change nothing.</div></div></div>
      ) : (
        <ol className="p-4 space-y-2">
          {plan.steps.map((s, i) => (
            <li key={s.index} className={cn('rounded-sm border border-border bg-background/60 rise', `tone-${STEP_TONE[s.kind] ?? 'idle'}`)} style={{ animationDelay: `${i * 35}ms` }} data-testid={`row-plan-step-${s.index}`}>
              <div className="flex items-center gap-2.5 px-3 py-2 border-l-[3px] border-[hsl(var(--t))] rounded-sm">
                <span className="font-mono text-[10.5px] text-muted-foreground tnum w-5">{String(s.index).padStart(2, '0')}</span>
                <span className="font-mono text-[11px] font-semibold text-[hsl(var(--t))]">{label(s.kind)}</span>
                {s.serviceName && <span className="font-mono text-[11px] rounded-sm bg-accent text-accent-foreground px-1.5">{s.serviceName}</span>}
                <span className="text-[13px] truncate">{s.summary}</span>
              </div>
              {s.changes.length > 0 && (
                <ul className="px-3 pb-2 pl-[52px] space-y-0.5">
                  {s.changes.map((c, j) => <li key={j} className="font-mono text-[11.5px] text-muted-foreground"><span className="text-[hsl(var(--t))]">~ </span>{c}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function PlanPanel({ id, onApply, live }: { id: string; onApply: () => void; live: boolean }) {
  const { data: plan, isLoading, error, refetch, isFetching } = useGetGroupPlan(id, { query: { enabled: !!id, queryKey: getGetGroupPlanQueryKey(id) } });
  return (
    <Panel
      title="Dry-run plan"
      count={plan ? (plan.isNoop ? 'no changes' : `${plan.steps.length} steps`) : undefined}
      actions={<>
        {plan && <span className="hidden md:inline font-mono text-[10.5px] text-muted-foreground mr-1">generated {stamp(plan.generatedAt, 'HH:mm:ss')}</span>}
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-plan"><RefreshCw className={cn(isFetching && 'animate-spin')} /></Button>
        <Button size="sm" onClick={onApply} disabled={!plan?.applicable || live} data-testid="button-apply-from-plan"><Play /> Apply</Button>
      </>}
    >
      {isLoading ? <RowsSkeleton rows={4} cols={3} /> : error ? <ErrorBlock error={error} onRetry={() => refetch()} className="m-4" /> : plan && <PlanView plan={plan} />}
    </Panel>
  );
}

/* ---------- Config ---------- */
function useConfigPatch(kind: 'group' | 'member') {
  const { toast } = useToast();
  const g = usePatchGroupConfig();
  const m = usePatchMemberConfig();
  return { g, m, toast, kind };
}

function ConfigTab({ g }: { g: GroupDetail }) {
  const qc = useQueryClient();
  const { g: patchG, m: patchM, toast } = useConfigPatch('group');
  const gc = useGetGroupConfig(g.id, { query: { enabled: !!g.id, queryKey: getGetGroupConfigQueryKey(g.id) } });
  const [memberId, setMemberId] = useState<string>(g.members[0]?.id ?? '');
  const member = g.members.find((m) => m.id === memberId);
  const mc = useGetMemberConfig(g.id, memberId, { query: { enabled: !!memberId, queryKey: getGetMemberConfigQueryKey(g.id, memberId) } });
  const env = useGetMemberEnv(g.id, memberId, { query: { enabled: !!memberId, queryKey: getGetMemberEnvQueryKey(g.id, memberId) } });

  const after = (title: string) => {
    qc.invalidateQueries({ queryKey: getGetGroupPlanQueryKey(g.id) });
    g.members.forEach((m) => qc.invalidateQueries({ queryKey: getGetMemberEnvQueryKey(g.id, m.id) }));
    toast({ title, description: 'Takes effect on the next apply.' });
  };
  const fail = (e: unknown) => toast({ title: 'Config not saved', description: errMsg(e), variant: 'destructive' });
  const patchGroup = (data: ConfigPatch, done: () => void) => patchG.mutate({ id: g.id, data }, {
    onSuccess: (res) => { qc.setQueryData(getGetGroupConfigQueryKey(g.id), res); after(data.remove ? `${data.remove[0]} removed` : `${data.set?.[0]?.key} saved`); done(); },
    onError: (e) => { fail(e); done(); },
  });
  const patchMember = (data: ConfigPatch, done: () => void) => patchM.mutate({ id: g.id, memberId, data }, {
    onSuccess: (res) => { qc.setQueryData(getGetMemberConfigQueryKey(g.id, memberId), res); after(data.remove ? `${data.remove[0]} removed` : `${data.set?.[0]?.key} saved`); done(); },
    onError: (e) => { fail(e); done(); },
  });

  return (
    <div className="space-y-4">
      <Panel title="Group variables" count={gc.data?.data.length}>
        <ConfigEditor scope="Every member" prefix={g.injectionPrefix} entries={gc.data?.data} isLoading={gc.isLoading} error={gc.error} onRetry={() => gc.refetch()} onPatch={patchGroup} pending={patchG.isPending} />
      </Panel>
      {!g.members.length ? (
        <Panel title="Member variables"><div className="px-4 py-6 text-[13px] text-muted-foreground">Add members to set per-member variables and preview their environment.</div></Panel>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="eyebrow mr-2">Member</span>
            {g.members.map((m) => (
              <button key={m.id} onClick={() => setMemberId(m.id)} data-testid={`button-config-member-${m.id}`} className={cn('h-7 px-2.5 rounded font-mono text-[12px] border transition-all', memberId === m.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card hover:border-foreground/40')}>
                {m.serviceName}
              </button>
            ))}
          </div>
          <div className="grid xl:grid-cols-2 gap-4">
            <Panel title={<>Overrides for <span className="font-mono">{member?.serviceName}</span></>} count={mc.data?.data.length}>
              <ConfigEditor key={memberId} scope="This member only" prefix={g.injectionPrefix} entries={mc.data?.data} isLoading={mc.isLoading} error={mc.error} onRetry={() => mc.refetch()} onPatch={patchMember} pending={patchM.isPending} />
            </Panel>
            <Panel title={<span className="inline-flex items-center gap-1.5"><Eye className="size-3.5" /> Effective environment</span>} count={env.data?.entries.length}>
              {env.isLoading ? <RowsSkeleton rows={5} cols={2} /> : env.error ? <ErrorBlock error={env.error} onRetry={() => env.refetch()} className="m-4" /> : !env.data?.entries.length ? (
                <div className="px-4 py-6 text-[13px] text-muted-foreground">Nothing will be set.</div>
              ) : (
                <div className="font-mono text-[12px] max-h-[460px] overflow-y-auto">
                  {env.data.entries.map((e) => (
                    <div key={e.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_64px] gap-3 px-4 py-1.5 border-b border-border/60 row-hover" data-testid={`row-env-${e.key}`}>
                      <span className={cn('truncate font-semibold', e.origin === 'INJECTED' && 'text-primary')}>{e.key}</span>
                      <span className="truncate text-muted-foreground">{e.isSecret ? <span className="inline-flex items-center gap-1"><Lock className="size-3" />{e.sourceRef ? `← ${e.sourceRef}` : 'secret'}</span> : e.value ?? (e.sourceRef ? `← ${e.sourceRef}` : '')}</span>
                      <span className={cn('text-[10px] tracking-wider text-right', e.origin === 'INJECTED' ? 'text-primary' : e.origin === 'MEMBER' ? 'text-[hsl(var(--busy))]' : 'text-muted-foreground')}>{e.origin}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Ports ---------- */
function PortsTab({ g }: { g: GroupDetail }) {
  const { data, isLoading, error, refetch } = useListGroupPorts(g.id, { query: { enabled: !!g.id, queryKey: getListGroupPortsQueryKey(g.id) } });
  const byMember = Object.fromEntries(g.members.map((m) => [m.id, m.serviceName]));
  return (
    <Panel title="Port allocations" count={data?.data.length}>
      {isLoading ? <RowsSkeleton rows={3} cols={4} /> : error ? <ErrorBlock error={error} onRetry={() => refetch()} className="m-4" /> : !data?.data.length ? <div className="px-4 py-6 text-[13px] text-muted-foreground">No host ports held by this berth.</div> : (
        <table className="w-full text-[13px]">
          <thead><tr className="text-left eyebrow border-b border-border"><th className="font-normal px-4 py-2">Host port</th><th className="font-normal px-3">State</th><th className="font-normal px-3">Holder</th><th className="font-normal px-3">Reserved</th><th className="font-normal px-4">Released</th></tr></thead>
          <tbody className="divide-y divide-border">
            {data.data.map((a, i) => (
              <tr key={a.id} className={cn('rise', a.state === 'RELEASED' && 'opacity-55')} style={{ animationDelay: `${i * 25}ms` }} data-testid={`row-allocation-${a.id}`}>
                <td className="px-4 py-2"><PortTag port={a.hostPort} proto={a.protocol} /></td>
                <td className="px-3"><Pill value={a.state} live={false} /></td>
                <td className="px-3 font-mono text-[12px]">{a.memberId ? byMember[a.memberId] ?? a.memberId.slice(0, 8) : <span className="text-primary">group entry</span>}</td>
                <td className="px-3 text-[12px] text-muted-foreground"><When v={a.createdAt} /></td>
                <td className="px-4 text-[12px] text-muted-foreground">{a.releasedAt ? <When v={a.releasedAt} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/* ---------- History ---------- */
function HistoryTab({ g }: { g: GroupDetail }) {
  const ops = useListOperations({ groupId: g.id, pageSize: 25 });
  const ev = useListEvents({ groupId: g.id, pageSize: 30 });
  return (
    <div className="grid xl:grid-cols-2 gap-4">
      <Panel title="Operations" count={ops.data?.pagination.totalItems}>
        {ops.isLoading ? <RowsSkeleton rows={4} cols={3} /> : ops.error ? <ErrorBlock error={ops.error} onRetry={() => ops.refetch()} className="m-4" /> : !ops.data?.data.length ? <div className="px-4 py-6 text-[13px] text-muted-foreground">Never applied.</div> : (
          <ul className="divide-y divide-border">{ops.data.data.map((o, i) => (
            <li key={o.id} className="rise" style={{ animationDelay: `${i * 25}ms` }}>
              <Link href={`/operations/${o.id}`} className="grid grid-cols-[auto_1fr_auto] gap-3 items-center px-4 py-2.5 row-hover" data-testid={`link-history-op-${o.id}`}>
                <Pill value={o.state} />
                <div className="min-w-0"><div className="text-[13px] truncate">{o.kind.toLowerCase()} · {o.reason ?? <span className="text-muted-foreground">no reason</span>}</div><div className="font-mono text-[10.5px] text-muted-foreground">{o.createdBy ?? 'system'} · {duration(o.startedAt, o.finishedAt)}</div></div>
                <span className="text-[11px] text-muted-foreground"><When v={o.createdAt} /></span>
              </Link>
            </li>
          ))}</ul>
        )}
      </Panel>
      <Panel title="Berth log" count={ev.data?.pagination.totalItems}>
        {ev.isLoading ? <RowsSkeleton rows={5} cols={2} /> : !ev.data?.data.length ? <div className="px-4 py-6 text-[13px] text-muted-foreground">No events.</div> : <ul className="divide-y divide-border max-h-[560px] overflow-y-auto">{ev.data.data.map((e, i) => <EventRow key={e.id} e={e} i={i} compact />)}</ul>}
      </Panel>
    </div>
  );
}

/* ---------- Page ---------- */
export default function GroupDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: g, isLoading, error, refetch } = useGetGroup(id, { query: { enabled: !!id, queryKey: getGetGroupQueryKey(id) } });
  const plan = useGetGroupPlan(id, { query: { enabled: !!id, queryKey: getGetGroupPlanQueryKey(id) } });
  const del = useDeleteGroup();
  const [tab, setTab] = useState('members');
  const [applyOpen, setApplyOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [followId, setFollowId] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const apply = useMutation({
    mutationFn: (r: string) => createGroupApply(id, r ? { reason: r } : {}, { headers: { 'Idempotency-Key': crypto.randomUUID() } }),
    onSuccess: (op: Operation) => {
      setApplyOpen(false);
      setReason('');
      setFollowId(op.id);
      qc.invalidateQueries({ queryKey: getGetGroupQueryKey(id) });
      qc.invalidateQueries({ queryKey: getListOperationsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
      toast({ title: 'Apply started', description: `Operation ${op.id.slice(0, 8)} · ${op.steps.length} steps` });
    },
    onError: (e) => toast({ title: errCode(e) === 'OPERATION_IN_PROGRESS' ? 'Already applying' : 'Apply refused', description: errMsg(e), variant: 'destructive' }),
  });

  const onFinish = (op: Operation) => {
    invalidateGroup(qc, id);
    qc.invalidateQueries({ queryKey: getListOperationsQueryKey() });
    toast({ title: op.state === 'SUCCEEDED' ? 'Berth applied' : `Apply ${op.state.toLowerCase()}`, description: op.error ?? `${op.steps.length} steps in ${duration(op.startedAt, op.finishedAt)}`, variant: op.state === 'SUCCEEDED' ? undefined : 'destructive' });
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-80" /><Skeleton className="h-24 w-full" /><Skeleton className="h-72 w-full" /></div>;
  if (error || !g) return <ErrorBlock error={error} onRetry={() => refetch()} />;

  const applying = g.status === 'APPLYING' || apply.isPending;
  const p = plan.data;

  return (
    <div>
      <Link href="/groups" className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground mb-3" data-testid="link-back-groups"><ArrowLeft className="size-3.5" /> Berths</Link>
      <PageHeader
        eyebrow={<Link href={`/providers/${g.providerId}`} className="hover:text-primary">{g.providerName} · {g.providerKind === 'DOCKER_HOST' ? 'docker host' : 'ecs cluster'}</Link>}
        title={<span className="font-mono">{g.name}</span>}
        meta={<>
          <Pill value={g.status} />
          <span>{g.description ?? <span className="italic">No description</span>}</span>
          <span>{g.lastAppliedAt ? <>applied <When v={g.lastAppliedAt} /></> : 'never applied'}</span>
        </>}
        actions={<>
          <Button variant="outline" onClick={() => setEdit(true)} data-testid="button-edit-group"><Pencil /> Edit</Button>
          <Button variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => setConfirmDel(true)} data-testid="button-delete-group"><Trash2 /></Button>
          <Button onClick={() => setApplyOpen(true)} disabled={applying} className={cn('min-w-[120px]', applying && 'sweep')} data-testid="button-apply">
            <Play /> {applying ? 'Applying' : 'Plan & apply'}
          </Button>
        </>}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-px rounded-md overflow-hidden border border-card-border bg-card-border mb-4 shadow-sm rise" style={{ animationDelay: '40ms' }}>
        <div className="bg-card px-4 py-3 col-span-2 md:col-span-1 relative overflow-hidden">
          <div className="eyebrow">Entry port</div>
          <div className="font-display text-[30px] font-bold leading-none mt-1 tnum text-primary">:{g.entryPort}<span className="text-[13px] font-mono font-normal text-muted-foreground ml-1">{g.protocol.toLowerCase()}</span></div>
        </div>
        <div className="bg-card px-4 py-3"><div className="eyebrow">Members</div><div className="font-display text-[24px] font-bold mt-1 tnum">{g.members.length}</div></div>
        <div className="bg-card px-4 py-3"><div className="eyebrow">Ports held</div><div className="font-display text-[24px] font-bold mt-1 tnum">{g.allocations.filter((a) => a.state !== 'RELEASED').length}</div></div>
        <div className="bg-card px-4 py-3"><div className="eyebrow">Injection</div><div className="font-mono text-[14px] font-semibold mt-2">{g.injectionPrefix}* <span className="text-muted-foreground font-normal">v{g.injectionVersion}</span></div></div>
        <div className="bg-card px-4 py-3 min-w-0"><div className="eyebrow">Network</div><div className="font-mono text-[12.5px] mt-2 truncate" title={g.networkRef ?? ''}>{g.networkRef ?? <span className="text-muted-foreground">created on apply</span>}</div></div>
      </div>

      {g.driftReasons.length > 0 && (
        <div className="mb-4 rounded-md border border-[hsl(var(--warn)/.35)] bg-[hsl(var(--warn)/.06)] px-4 py-3 rise" data-testid="panel-drift">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[hsl(var(--warn))]"><Waves className="size-4" /> Drifted from the applied state</div>
          <ul className="mt-1.5 space-y-0.5 text-[12.5px]">{g.driftReasons.map((r) => <li key={r} className="pl-3 border-l-2 border-[hsl(var(--warn)/.4)]">{r}</li>)}</ul>
          <div className="mt-2 text-[12px] text-muted-foreground">Review the plan, then apply to bring the host back in line.</div>
        </div>
      )}

      {followId && (
        <Panel title="Live operation" className="mb-4 border-primary/30" actions={<Button size="sm" variant="ghost" onClick={() => setFollowId(null)} data-testid="button-dismiss-follow">Dismiss</Button>}>
          <LiveOperationCard id={followId} onFinish={onFinish} />
        </Panel>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 bg-muted/70 h-9">
          <TabsTrigger value="members" data-testid="tab-members">Members</TabsTrigger>
          <TabsTrigger value="plan" data-testid="tab-plan">Plan{p && !p.isNoop && <span className="ml-1.5 font-mono text-[10px] rounded-sm bg-primary text-primary-foreground px-1">{p.steps.length}</span>}</TabsTrigger>
          <TabsTrigger value="config" data-testid="tab-config">Config</TabsTrigger>
          <TabsTrigger value="ports" data-testid="tab-ports">Ports</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="members"><Members g={g} /></TabsContent>
        <TabsContent value="plan"><PlanPanel id={id} onApply={() => setApplyOpen(true)} live={applying} /></TabsContent>
        <TabsContent value="config"><ConfigTab g={g} /></TabsContent>
        <TabsContent value="ports"><PortsTab g={g} /></TabsContent>
        <TabsContent value="history"><HistoryTab g={g} /></TabsContent>
      </Tabs>

      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-[22px]">Apply <span className="font-mono">{g.name}</span></DialogTitle>
            <DialogDescription>Review the dry-run. Each click sends a fresh idempotency key, so a retried request never applies twice.</DialogDescription>
          </DialogHeader>
          <div className="rounded border border-border -mx-1">
            {plan.isLoading ? <RowsSkeleton rows={3} cols={3} /> : plan.error ? <ErrorBlock error={plan.error} onRetry={() => plan.refetch()} className="m-3" /> : p && <PlanView plan={p} />}
          </div>
          <div className="space-y-1.5">
            <div className="eyebrow">Reason · recorded in the audit log</div>
            <Textarea rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Rotate DB credentials for checkout" data-testid="input-apply-reason" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApplyOpen(false)}>Cancel</Button>
            <Button onClick={() => apply.mutate(reason.trim())} disabled={!p?.applicable || apply.isPending} className={cn(apply.isPending && 'sweep')} data-testid="button-confirm-apply">
              <Play /> {apply.isPending ? 'Starting' : p?.isNoop ? 'Apply anyway' : `Apply ${p?.steps.length ?? ''} steps`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {edit && <EditGroupDialog open={edit} onOpenChange={setEdit} group={g} />}
      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete berth {g.name}?</AlertDialogTitle>
            <AlertDialogDescription>All {g.members.length} members go back to adrift and :{g.entryPort} plus every allocated port is released. Containers are not stopped.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" disabled={del.isPending} data-testid="button-confirm-delete-group" onClick={(e) => {
              e.preventDefault();
              del.mutate({ id }, {
                onSuccess: () => { qc.invalidateQueries({ queryKey: getListGroupsQueryKey() }); qc.invalidateQueries({ queryKey: getListWorkloadsQueryKey() }); qc.invalidateQueries({ queryKey: getGetOverviewQueryKey() }); toast({ title: `${g.name} deleted` }); nav('/groups'); },
                onError: (err) => { setConfirmDel(false); toast({ title: 'Could not delete', description: errMsg(err), variant: 'destructive' }); },
              });
            }}>{del.isPending ? 'Deleting' : 'Delete berth'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
