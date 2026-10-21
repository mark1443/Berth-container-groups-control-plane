import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetGroupPlanQueryKey, getGetGroupQueryKey, getGetOverviewQueryKey, getListGroupPortsQueryKey, getListGroupsQueryKey, getListWorkloadsQueryKey,
  useAddGroupMember, useCreateGroup, useListProviders, useListWorkloads, useUpdateGroup, useUpdateGroupMember,
  type GroupDetail, type GroupMember, type GroupMemberInput, type HealthCheck, type MemberRole, type Protocol, type Workload,
} from '@workspace/api-client-react';
import { errMsg } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorkloadPill } from '@/components/berth';

const NAME_RE = /^[a-z][a-z0-9-]{0,62}$/;
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 63);

function F({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-[12px] font-medium">{label}</Label>
      {children}
      {error ? <div className="text-[11px] text-destructive">{error}</div> : hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
function FormError({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="rounded-sm border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive" data-testid="text-form-error">{msg}</div>;
}

function RoleSelect({ value, onChange, testId }: { value: MemberRole; onChange: (r: MemberRole) => void; testId: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as MemberRole)}>
      <SelectTrigger className="h-8 text-[12px]" data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="ENTRY">Entry — owns the group port</SelectItem>
        <SelectItem value="INTERNAL">Internal — reachable by peers only</SelectItem>
        <SelectItem value="EXPOSED">Exposed — gets an allocated host port</SelectItem>
      </SelectContent>
    </Select>
  );
}

function invalidateGroup(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: getGetGroupQueryKey(id) });
  qc.invalidateQueries({ queryKey: getGetGroupPlanQueryKey(id) });
  qc.invalidateQueries({ queryKey: getListGroupPortsQueryKey(id) });
  qc.invalidateQueries({ queryKey: getListGroupsQueryKey() });
  qc.invalidateQueries({ queryKey: getListWorkloadsQueryKey() });
  qc.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
}
export { invalidateGroup };

type Pick = { serviceName: string; role: MemberRole; containerPort: string };
const defaultPort = (w: Workload) => String(w.ports[0]?.containerPort ?? 80);

export function CreateGroupDialog({ open, onOpenChange, onCreated, presetProviderId }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (g: GroupDetail) => void; presetProviderId?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateGroup();
  const { data: providers } = useListProviders({ pageSize: 200 });
  const [providerId, setProviderId] = useState(presetProviderId ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [entryPort, setEntryPort] = useState('8080');
  const [protocol, setProtocol] = useState<Protocol>('TCP');
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [err, setErr] = useState<string | null>(null);
  const params = { providerId, managed: false, pageSize: 200 };
  const { data: wl, isLoading: wlLoading } = useListWorkloads(params, { query: { enabled: !!providerId, queryKey: getListWorkloadsQueryKey(params) } });
  useEffect(() => setPicks({}), [providerId]);
  const nameErr = name && !NAME_RE.test(name) ? 'lowercase letters, digits, dashes; start with a letter' : null;
  const portN = Number(entryPort);
  const entries = Object.values(picks).filter((p) => p.role === 'ENTRY').length;

  const toggle = (w: Workload) =>
    setPicks((p) => {
      const n = { ...p };
      if (n[w.id]) delete n[w.id];
      else n[w.id] = { serviceName: slug(w.name) || 'svc', role: Object.values(p).some((x) => x.role === 'ENTRY') ? 'INTERNAL' : 'ENTRY', containerPort: defaultPort(w) };
      return n;
    });

  const submit = () => {
    setErr(null);
    const members: GroupMemberInput[] = Object.entries(picks).map(([workloadId, p]) => ({ workloadId, serviceName: p.serviceName, role: p.role, containerPort: Number(p.containerPort) }));
    create.mutate(
      { data: { providerId, name, entryPort: portN, protocol, ...(description ? { description } : {}), ...(members.length ? { members } : {}) } },
      {
        onSuccess: (g) => {
          qc.invalidateQueries({ queryKey: getListGroupsQueryKey() });
          qc.invalidateQueries({ queryKey: getListWorkloadsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
          toast({ title: `Berth ${g.name} created`, description: `Entry :${g.entryPort}/${g.protocol.toLowerCase()} reserved · ${g.members.length} members` });
          onOpenChange(false);
          onCreated(g);
        },
        onError: (e) => setErr(errMsg(e)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-[22px]">Create a berth</DialogTitle>
          <DialogDescription>A berth gathers containers on one provider behind a single entry port. Nothing changes on the host until you apply.</DialogDescription>
        </DialogHeader>
        <div className="grid md:grid-cols-4 gap-4">
          <F label="Provider" className="md:col-span-2">
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger data-testid="select-group-provider"><SelectValue placeholder="Choose a provider" /></SelectTrigger>
              <SelectContent>
                {providers?.data.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} · {p.kind === 'DOCKER_HOST' ? 'docker' : 'ecs'}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>
          <F label="Name" error={nameErr} hint="DNS-safe slug" className="md:col-span-2">
            <Input className="font-mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="checkout-api" data-testid="input-group-name" />
          </F>
          <F label="Entry port"><Input className="font-mono" type="number" value={entryPort} onChange={(e) => setEntryPort(e.target.value)} data-testid="input-group-entry-port" /></F>
          <F label="Protocol">
            <Select value={protocol} onValueChange={(v) => setProtocol(v as Protocol)}>
              <SelectTrigger data-testid="select-group-protocol"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="TCP">TCP</SelectItem><SelectItem value="UDP">UDP</SelectItem></SelectContent>
            </Select>
          </F>
          <F label="Description" className="md:col-span-2"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What lives here" data-testid="input-group-description" /></F>
        </div>
        <div className="rounded border border-border mt-1">
          <div className="flex items-center justify-between px-3 h-10 border-b border-border bg-muted/40">
            <span className="eyebrow">Initial members · unmanaged workloads</span>
            <span className={cn('font-mono text-[11px]', entries > 1 ? 'text-destructive' : 'text-muted-foreground')}>{Object.keys(picks).length} picked{entries > 1 && ' · only one ENTRY allowed'}</span>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-border">
            {!providerId ? (
              <div className="px-3 py-6 text-[12.5px] text-muted-foreground text-center">Choose a provider to see its unmanaged workloads.</div>
            ) : wlLoading ? (
              <div className="px-3 py-6 text-[12.5px] text-muted-foreground text-center sweep">Reading inventory</div>
            ) : !wl?.data.length ? (
              <div className="px-3 py-6 text-[12.5px] text-muted-foreground text-center">Every workload on this provider already has a berth. You can create the group empty.</div>
            ) : (
              wl.data.map((w) => {
                const p = picks[w.id];
                return (
                  <div key={w.id} className={cn('px-3 py-2 transition-colors', p && 'bg-accent/40')}>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <Checkbox checked={!!p} onCheckedChange={() => toggle(w)} data-testid={`checkbox-member-${w.id}`} />
                      <span className="font-mono text-[12.5px] font-semibold truncate">{w.name}</span>
                      <span className="text-[11.5px] text-muted-foreground truncate flex-1">{w.image}</span>
                      <WorkloadPill value={w.status} />
                    </label>
                    {p && (
                      <div className="grid grid-cols-[1fr_1.3fr_90px] gap-2 mt-2 pl-7 rise">
                        <Input className="h-8 font-mono text-[12px]" value={p.serviceName} onChange={(e) => setPicks({ ...picks, [w.id]: { ...p, serviceName: e.target.value } })} data-testid={`input-member-service-${w.id}`} />
                        <RoleSelect value={p.role} onChange={(r) => setPicks({ ...picks, [w.id]: { ...p, role: r } })} testId={`select-member-role-${w.id}`} />
                        <Input className="h-8 font-mono text-[12px]" type="number" value={p.containerPort} onChange={(e) => setPicks({ ...picks, [w.id]: { ...p, containerPort: e.target.value } })} data-testid={`input-member-port-${w.id}`} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
        <FormError msg={err} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!providerId || !name || !!nameErr || !(portN > 0 && portN < 65536) || entries > 1 || create.isPending} data-testid="button-submit-group">
            {create.isPending ? 'Reserving port' : 'Create berth'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditGroupDialog({ open, onOpenChange, group }: { open: boolean; onOpenChange: (o: boolean) => void; group: GroupDetail }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateGroup();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [entryPort, setEntryPort] = useState(String(group.entryPort));
  const [protocol, setProtocol] = useState<Protocol>(group.protocol);
  const [err, setErr] = useState<string | null>(null);
  const nameErr = name && !NAME_RE.test(name) ? 'lowercase letters, digits, dashes' : null;
  const submit = () => {
    setErr(null);
    update.mutate(
      { id: group.id, data: { name, description: description || null, entryPort: Number(entryPort), protocol } },
      {
        onSuccess: (g) => {
          qc.setQueryData(getGetGroupQueryKey(group.id), g);
          invalidateGroup(qc, group.id);
          toast({ title: 'Berth updated', description: 'Review the plan before applying.' });
          onOpenChange(false);
        },
        onError: (e) => setErr(errMsg(e)),
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-[22px]">Edit berth</DialogTitle>
          <DialogDescription>Changing the entry port re-reserves it on {group.providerName}.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <F label="Name" error={nameErr} className="col-span-2"><Input className="font-mono" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-edit-group-name" /></F>
          <F label="Entry port"><Input className="font-mono" type="number" value={entryPort} onChange={(e) => setEntryPort(e.target.value)} data-testid="input-edit-group-port" /></F>
          <F label="Protocol">
            <Select value={protocol} onValueChange={(v) => setProtocol(v as Protocol)}>
              <SelectTrigger data-testid="select-edit-group-protocol"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="TCP">TCP</SelectItem><SelectItem value="UDP">UDP</SelectItem></SelectContent>
            </Select>
          </F>
          <F label="Description" className="col-span-2"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-edit-group-description" /></F>
        </div>
        <FormError msg={err} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!name || !!nameErr || update.isPending} data-testid="button-save-group">{update.isPending ? 'Saving' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HealthFields({ hc, setHc }: { hc: HealthCheck | null; setHc: (h: HealthCheck | null) => void }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <F label="Health check">
        <Select value={hc?.kind ?? 'NONE'} onValueChange={(v) => setHc(v === 'NONE' ? null : { kind: v as 'TCP' | 'HTTP', timeoutSeconds: hc?.timeoutSeconds ?? 5, ...(v === 'HTTP' ? { path: hc?.path ?? '/healthz' } : {}) })}>
          <SelectTrigger data-testid="select-health-kind"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="NONE">None</SelectItem><SelectItem value="TCP">TCP</SelectItem><SelectItem value="HTTP">HTTP</SelectItem></SelectContent>
        </Select>
      </F>
      {hc?.kind === 'HTTP' && <F label="Path"><Input className="font-mono" value={hc.path ?? ''} onChange={(e) => setHc({ ...hc, path: e.target.value })} data-testid="input-health-path" /></F>}
      {hc && <F label="Timeout (s)"><Input className="font-mono" type="number" value={hc.timeoutSeconds ?? ''} onChange={(e) => setHc({ ...hc, timeoutSeconds: e.target.value ? Number(e.target.value) : undefined })} data-testid="input-health-timeout" /></F>}
    </div>
  );
}

export function MemberDialog({ open, onOpenChange, group, member }: { open: boolean; onOpenChange: (o: boolean) => void; group: GroupDetail; member?: GroupMember }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const add = useAddGroupMember();
  const upd = useUpdateGroupMember();
  const hasEntry = group.members.some((m) => m.role === 'ENTRY' && m.id !== member?.id);
  const [workloadId, setWorkloadId] = useState('');
  const [serviceName, setServiceName] = useState(member?.serviceName ?? '');
  const [role, setRole] = useState<MemberRole>(member?.role ?? (hasEntry ? 'INTERNAL' : 'ENTRY'));
  const [containerPort, setContainerPort] = useState(member ? String(member.containerPort) : '');
  const [hc, setHc] = useState<HealthCheck | null>(member?.healthCheck ?? null);
  const [err, setErr] = useState<string | null>(null);
  const params = { providerId: group.providerId, managed: false, pageSize: 200 };
  const { data: wl } = useListWorkloads(params, { query: { enabled: !member && open, queryKey: getListWorkloadsQueryKey(params) } });
  const picked = useMemo(() => wl?.data.find((w) => w.id === workloadId), [wl, workloadId]);
  const nameErr = serviceName && !NAME_RE.test(serviceName) ? 'lowercase letters, digits, dashes' : null;

  const choose = (id: string) => {
    setWorkloadId(id);
    const w = wl?.data.find((x) => x.id === id);
    if (w) {
      if (!serviceName) setServiceName(slug(w.name));
      if (!containerPort) setContainerPort(defaultPort(w));
    }
  };
  const done = (title: string) => {
    invalidateGroup(qc, group.id);
    toast({ title, description: 'Plan updated. Apply when ready.' });
    onOpenChange(false);
  };
  const submit = () => {
    setErr(null);
    if (member) {
      upd.mutate({ id: group.id, memberId: member.id, data: { serviceName, role, containerPort: Number(containerPort), healthCheck: hc } }, { onSuccess: () => done(`${serviceName} updated`), onError: (e) => setErr(errMsg(e)) });
    } else {
      add.mutate({ id: group.id, data: { workloadId, serviceName: serviceName || undefined, role, containerPort: Number(containerPort), ...(hc ? { healthCheck: hc } : {}) } }, { onSuccess: (m) => done(`${m.serviceName} berthed`), onError: (e) => setErr(errMsg(e)) });
    }
  };
  const pending = add.isPending || upd.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-[22px]">{member ? `Edit ${member.serviceName}` : 'Add a member'}</DialogTitle>
          <DialogDescription>{member ? member.workloadName : `Unmanaged workloads on ${group.providerName}.`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!member && (
            <F label="Workload">
              <Select value={workloadId} onValueChange={choose}>
                <SelectTrigger data-testid="select-member-workload"><SelectValue placeholder={wl && !wl.data.length ? 'No unmanaged workloads' : 'Choose a workload'} /></SelectTrigger>
                <SelectContent>
                  {wl?.data.map((w) => <SelectItem key={w.id} value={w.id}>{w.name} · {w.image}</SelectItem>)}
                </SelectContent>
              </Select>
              {picked && <div className="font-mono text-[11px] text-muted-foreground mt-1">exposes {picked.ports.map((p) => `${p.containerPort}/${p.protocol.toLowerCase()}`).join(', ') || 'no ports'}</div>}
            </F>
          )}
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <F label="Service name" error={nameErr} hint={`Peers see ${group.injectionPrefix}${(serviceName || 'name').toUpperCase().replace(/-/g, '_')}_*`}><Input className="font-mono" value={serviceName} onChange={(e) => setServiceName(e.target.value)} data-testid="input-member-service" /></F>
            <F label="Container port"><Input className="font-mono" type="number" value={containerPort} onChange={(e) => setContainerPort(e.target.value)} data-testid="input-member-port" /></F>
          </div>
          <F label="Role" hint={role === 'ENTRY' && hasEntry ? 'This berth already has an entry member.' : undefined} error={role === 'ENTRY' && hasEntry ? 'Another member already holds ENTRY' : null}>
            <RoleSelect value={role} onChange={setRole} testId="select-member-role" />
          </F>
          <HealthFields hc={hc} setHc={setHc} />
        </div>
        <FormError msg={err} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={(!member && !workloadId) || !containerPort || !!nameErr || pending} data-testid="button-submit-member">{pending ? 'Saving' : member ? 'Save member' : 'Add member'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
