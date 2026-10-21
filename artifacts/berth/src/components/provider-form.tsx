import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Cloud, Server } from 'lucide-react';
import {
  getGetOverviewQueryKey, getGetProviderQueryKey, getListProvidersQueryKey, useCreateProvider, useUpdateProvider,
  type CredentialKind, type Provider, type ProviderCredentialInput, type ProviderKind, type ProviderSettings,
} from '@workspace/api-client-react';
import { errMsg } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

function F({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-[12px] font-medium">{label}</Label>
      {children}
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange, testId }: { value: T; options: [T, string][]; onChange: (v: T) => void; testId: string }) {
  return (
    <div className="inline-flex rounded border border-border bg-muted/60 p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} data-testid={`${testId}-${v.toLowerCase()}`} className={cn('h-7 px-3 rounded-sm text-[12px] font-medium transition-all', value === v ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function ProviderFormDialog({ open, onOpenChange, provider, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; provider?: Provider; onCreated?: (p: Provider) => void }) {
  const editing = !!provider;
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const [kind, setKind] = useState<ProviderKind>(provider?.kind ?? 'DOCKER_HOST');
  const [name, setName] = useState(provider?.name ?? '');
  const [s, setS] = useState<ProviderSettings>(provider?.settings ?? { transport: 'SSH', port: 22, sshUser: 'ubuntu', portRangeStart: 20000, portRangeEnd: 20999 });
  const [rotate, setRotate] = useState(!editing);
  const [cred, setCred] = useState<ProviderCredentialInput>({ kind: provider?.credential?.kind ?? 'SSH_KEY' });
  const [err, setErr] = useState<string | null>(null);

  const setSet = (k: keyof ProviderSettings, v: string | number | undefined) => setS((p) => ({ ...p, [k]: v === '' ? undefined : v }));
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const switchKind = (k: ProviderKind) => {
    setKind(k);
    if (k === 'ECS_CLUSTER') {
      setS({ region: 'eu-west-1', portRangeStart: s.portRangeStart, portRangeEnd: s.portRangeEnd });
      setCred({ kind: 'AWS_ROLE' });
    } else {
      setS({ transport: 'SSH', port: 22, sshUser: 'ubuntu', portRangeStart: s.portRangeStart, portRangeEnd: s.portRangeEnd });
      setCred({ kind: 'SSH_KEY' });
    }
  };
  const credKinds: [CredentialKind, string][] = kind === 'DOCKER_HOST' ? [['SSH_KEY', 'SSH key'], ['TLS_BUNDLE', 'TLS bundle']] : [['AWS_ROLE', 'Assume role'], ['AWS_KEYS', 'Access keys']];
  const pending = create.isPending || update.isPending;

  const submit = () => {
    setErr(null);
    const clean = Object.fromEntries(Object.entries(cred).filter(([, v]) => v !== '' && v !== undefined)) as unknown as ProviderCredentialInput;
    const done = (p: Provider) => {
      qc.invalidateQueries({ queryKey: getListProvidersQueryKey() });
      qc.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
      qc.setQueryData(getGetProviderQueryKey(p.id), p);
      toast({ title: editing ? 'Provider updated' : `${p.name} registered`, description: `Status ${p.status.toLowerCase()}${p.lastError ? ` — ${p.lastError}` : ''}` });
      onOpenChange(false);
      onCreated?.(p);
    };
    const fail = (e: unknown) => setErr(errMsg(e));
    if (provider) {
      update.mutate({ id: provider.id, data: { name, settings: s, ...(rotate ? { credential: clean } : {}) } }, { onSuccess: done, onError: fail });
    } else {
      create.mutate({ data: { kind, name, settings: s, credential: clean } }, { onSuccess: done, onError: fail });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-[22px]">{editing ? `Edit ${provider.name}` : 'Register a provider'}</DialogTitle>
          <DialogDescription>Credentials are stored encrypted and never returned. A connectivity check runs on save.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {!editing && (
            <div className="grid grid-cols-2 gap-2">
              {([['DOCKER_HOST', 'Docker host', 'EC2 or VPS over SSH or TCP+TLS', Server], ['ECS_CLUSTER', 'ECS cluster', 'AWS keys or an assumed role', Cloud]] as const).map(([k, t, d, I]) => (
                <button key={k} type="button" onClick={() => switchKind(k)} data-testid={`button-kind-${k.toLowerCase()}`} className={cn('text-left rounded border p-3 transition-all', kind === k ? 'border-primary bg-primary/5 shadow-[inset_0_0_0_1px_hsl(var(--primary))]' : 'border-border hover:border-foreground/30')}>
                  <I className={cn('size-4 mb-2', kind === k ? 'text-primary' : 'text-muted-foreground')} />
                  <div className="text-[13px] font-semibold">{t}</div>
                  <div className="text-[11.5px] text-muted-foreground">{d}</div>
                </button>
              ))}
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            <F label="Name" className="md:col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'DOCKER_HOST' ? 'lisbon-vps-02' : 'prod-ecs-eu'} data-testid="input-provider-name" /></F>
            {kind === 'DOCKER_HOST' ? (
              <>
                <F label="Transport" className="md:col-span-2">
                  <Seg value={s.transport ?? 'SSH'} options={[['SSH', 'SSH'], ['TCP_TLS', 'TCP + TLS']]} testId="seg-transport" onChange={(v) => { setS({ ...s, transport: v, port: v === 'SSH' ? 22 : 2376 }); setCred({ kind: v === 'SSH' ? 'SSH_KEY' : 'TLS_BUNDLE' }); }} />
                </F>
                <F label="Host"><Input className="font-mono" value={s.host ?? ''} onChange={(e) => setSet('host', e.target.value)} placeholder="10.0.4.17" data-testid="input-provider-host" /></F>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Port"><Input className="font-mono" type="number" value={s.port ?? ''} onChange={(e) => setSet('port', num(e.target.value))} data-testid="input-provider-port" /></F>
                  {s.transport !== 'TCP_TLS' && <F label="SSH user"><Input className="font-mono" value={s.sshUser ?? ''} onChange={(e) => setSet('sshUser', e.target.value)} data-testid="input-provider-sshuser" /></F>}
                </div>
              </>
            ) : (
              <>
                <F label="Region"><Input className="font-mono" value={s.region ?? ''} onChange={(e) => setSet('region', e.target.value)} data-testid="input-provider-region" /></F>
                <F label="VPC id"><Input className="font-mono" value={s.vpcId ?? ''} onChange={(e) => setSet('vpcId', e.target.value)} placeholder="vpc-0a3f..." data-testid="input-provider-vpc" /></F>
                <F label="Cluster ARN" className="md:col-span-2"><Input className="font-mono" value={s.clusterArn ?? ''} onChange={(e) => setSet('clusterArn', e.target.value)} placeholder="arn:aws:ecs:eu-west-1:123456789012:cluster/prod" data-testid="input-provider-cluster" /></F>
              </>
            )}
            <F label="Host port range start" hint="Berth allocates EXPOSED ports from this range"><Input className="font-mono" type="number" value={s.portRangeStart ?? ''} onChange={(e) => setSet('portRangeStart', num(e.target.value))} data-testid="input-range-start" /></F>
            <F label="Host port range end"><Input className="font-mono" type="number" value={s.portRangeEnd ?? ''} onChange={(e) => setSet('portRangeEnd', num(e.target.value))} data-testid="input-range-end" /></F>
          </div>

          <div className="rounded border border-border">
            <div className="flex items-center justify-between px-3 h-10 border-b border-border bg-muted/40">
              <span className="eyebrow">Credential</span>
              {editing && (
                <label className="flex items-center gap-2 text-[12px]">
                  Replace credential <Switch checked={rotate} onCheckedChange={setRotate} data-testid="switch-rotate" />
                </label>
              )}
            </div>
            {rotate ? (
              <div className="p-3 space-y-3">
                <Seg value={cred.kind} options={credKinds} testId="seg-cred" onChange={(k) => setCred({ kind: k })} />
                {cred.kind === 'SSH_KEY' && (
                  <>
                    <F label="Private key (PEM / OpenSSH)"><Textarea rows={4} className="font-mono text-[11.5px]" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={cred.privateKey ?? ''} onChange={(e) => setCred({ ...cred, privateKey: e.target.value })} data-testid="input-private-key" /></F>
                    <F label="Passphrase (optional)"><Input type="password" autoComplete="off" value={cred.passphrase ?? ''} onChange={(e) => setCred({ ...cred, passphrase: e.target.value })} data-testid="input-passphrase" /></F>
                  </>
                )}
                {cred.kind === 'TLS_BUNDLE' && (
                  <div className="grid md:grid-cols-3 gap-3">
                    {(['caCert', 'clientCert', 'clientKey'] as const).map((k) => (
                      <F key={k} label={{ caCert: 'CA cert', clientCert: 'Client cert', clientKey: 'Client key' }[k]}>
                        <Textarea rows={4} className="font-mono text-[11px]" value={cred[k] ?? ''} onChange={(e) => setCred({ ...cred, [k]: e.target.value })} data-testid={`input-${k}`} />
                      </F>
                    ))}
                  </div>
                )}
                {cred.kind === 'AWS_KEYS' && (
                  <div className="grid md:grid-cols-2 gap-3">
                    <F label="Access key id"><Input className="font-mono" value={cred.accessKeyId ?? ''} onChange={(e) => setCred({ ...cred, accessKeyId: e.target.value })} data-testid="input-access-key" /></F>
                    <F label="Secret access key"><Input type="password" autoComplete="off" className="font-mono" value={cred.secretAccessKey ?? ''} onChange={(e) => setCred({ ...cred, secretAccessKey: e.target.value })} data-testid="input-secret-key" /></F>
                    <F label="Session token (optional)" className="md:col-span-2"><Input type="password" autoComplete="off" className="font-mono" value={cred.sessionToken ?? ''} onChange={(e) => setCred({ ...cred, sessionToken: e.target.value })} data-testid="input-session-token" /></F>
                  </div>
                )}
                {cred.kind === 'AWS_ROLE' && (
                  <div className="grid md:grid-cols-2 gap-3">
                    <F label="Role ARN" className="md:col-span-2"><Input className="font-mono" placeholder="arn:aws:iam::123456789012:role/berth-operator" value={cred.roleArn ?? ''} onChange={(e) => setCred({ ...cred, roleArn: e.target.value })} data-testid="input-role-arn" /></F>
                    <F label="External id (optional)"><Input className="font-mono" value={cred.externalId ?? ''} onChange={(e) => setCred({ ...cred, externalId: e.target.value })} data-testid="input-external-id" /></F>
                  </div>
                )}
              </div>
            ) : (
              <div className="px-3 py-3 text-[12.5px] text-muted-foreground">
                Keeping the current <span className="font-mono text-foreground">{provider?.credential?.kind ?? 'credential'}</span> (v{provider?.credential?.keyVersion ?? 1}).
              </div>
            )}
          </div>
          {err && <div className="rounded-sm border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive" data-testid="text-form-error">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel-provider">Cancel</Button>
          <Button onClick={submit} disabled={!name || pending} className={cn(pending && 'sweep')} data-testid="button-submit-provider">
            {pending ? 'Checking connectivity' : editing ? 'Save changes' : 'Register and check'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
