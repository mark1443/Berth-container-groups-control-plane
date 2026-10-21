import { useState } from 'react';
import { KeyRound, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { ConfigEntry, ConfigPatch, ConfigSource } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { label } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Empty, ErrorBlock, RowsSkeleton, When } from '@/components/berth';

type Draft = { key: string; value: string; isSecret: boolean; source: ConfigSource; sourceRef: string; editing: boolean };
const blank: Draft = { key: '', value: '', isSecret: false, source: 'MANUAL', sourceRef: '', editing: false };
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function ConfigEditor({ entries, isLoading, error, onRetry, onPatch, pending, scope, prefix }: {
  entries: ConfigEntry[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onPatch: (p: ConfigPatch, done: () => void) => void;
  pending: boolean;
  scope: string;
  prefix?: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const keyErr = draft && draft.key && !KEY_RE.test(draft.key) ? 'Letters, digits, underscore; cannot start with a digit' : prefix && draft?.key.startsWith(prefix) ? `${prefix}* is reserved for injected variables` : null;
  const needsRef = draft && draft.source !== 'MANUAL';
  const valid = !!draft && !!draft.key && !keyErr && (needsRef ? !!draft.sourceRef : draft.editing && draft.isSecret ? true : draft.value !== '' || !draft.isSecret);

  const submit = () => {
    if (!draft || !valid) return;
    const entry: ConfigPatch['set'] = [{
      key: draft.key,
      isSecret: draft.isSecret,
      source: draft.source,
      ...(draft.source === 'MANUAL' ? (draft.isSecret && draft.editing && !draft.value ? {} : { value: draft.value }) : { sourceRef: draft.sourceRef }),
    }];
    onPatch({ set: entry }, () => setDraft(null));
  };

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-card-border bg-muted/40">
        <span className="eyebrow">{scope}</span>
        {!draft && (
          <Button size="sm" variant="outline" onClick={() => setDraft({ ...blank })} data-testid={`button-add-config-${scope}`}>
            <Plus /> Add variable
          </Button>
        )}
      </div>
      {draft && (
        <div className="border-b border-card-border bg-accent/40 p-4 grid gap-3 md:grid-cols-[1.1fr_0.9fr_1.6fr_auto] items-start rise">
          <div>
            <Input placeholder="KEY_NAME" value={draft.key} disabled={draft.editing} onChange={(e) => setDraft({ ...draft, key: e.target.value.toUpperCase() })} className="font-mono h-9" data-testid="input-config-key" />
            {keyErr && <div className="text-[11px] text-destructive mt-1">{keyErr}</div>}
          </div>
          <Select value={draft.source} onValueChange={(v) => setDraft({ ...draft, source: v as ConfigSource, isSecret: v === 'AWS_SECRETS_MANAGER' ? true : draft.isSecret })}>
            <SelectTrigger className="h-9" data-testid="select-config-source"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MANUAL">Manual value</SelectItem>
              <SelectItem value="AWS_SSM">AWS SSM parameter</SelectItem>
              <SelectItem value="AWS_SECRETS_MANAGER">AWS Secrets Manager</SelectItem>
            </SelectContent>
          </Select>
          <div className="space-y-2">
            {draft.source === 'MANUAL' ? (
              <Input
                type={draft.isSecret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={draft.isSecret && draft.editing ? 'Enter a new value (current value is never shown)' : 'value'}
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                className="font-mono h-9"
                data-testid="input-config-value"
              />
            ) : (
              <Input placeholder={draft.source === 'AWS_SSM' ? '/prod/app/DATABASE_URL' : 'arn:aws:secretsmanager:...'} value={draft.sourceRef} onChange={(e) => setDraft({ ...draft, sourceRef: e.target.value })} className="font-mono h-9" data-testid="input-config-ref" />
            )}
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Switch checked={draft.isSecret} onCheckedChange={(c) => setDraft({ ...draft, isSecret: c })} data-testid="switch-config-secret" />
              Secret — write-only, never displayed after save
            </label>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={submit} disabled={!valid || pending} data-testid="button-save-config">{pending ? 'Saving' : 'Save'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)} data-testid="button-cancel-config"><X /></Button>
          </div>
        </div>
      )}
      {isLoading ? (
        <RowsSkeleton rows={3} cols={3} />
      ) : error ? (
        <ErrorBlock error={error} onRetry={onRetry} className="m-4" />
      ) : !entries?.length ? (
        <Empty icon={<KeyRound className="size-5" />} title="No variables yet" body={`Variables set here apply to ${scope.toLowerCase()}. Mark sensitive ones as secret.`} className="py-8" />
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((e, i) => (
            <li key={e.key} className={cn('group grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(160px,0.9fr)_minmax(0,1.6fr)_auto_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 row-hover rise', removing === e.key && 'opacity-40')} style={{ animationDelay: `${i * 25}ms` }} data-testid={`row-config-${e.key}`}>
              <span className="font-mono text-[12.5px] font-semibold truncate">{e.key}</span>
              <span className="min-w-0 font-mono text-[12px] truncate order-3 md:order-none col-span-2 md:col-span-1">
                {e.isSecret ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Lock className="size-3" /> {e.valuePresent || e.sourceRef ? 'secret · set' : 'secret · empty'}{e.sourceRef && <span className="truncate"> ← {e.sourceRef}</span>}</span>
                ) : e.source !== 'MANUAL' ? (
                  <span className="text-muted-foreground">← {e.sourceRef}</span>
                ) : (
                  <span>{e.value ?? ''}</span>
                )}
              </span>
              <span className="hidden md:flex items-center gap-2 text-[11px] text-muted-foreground">
                {e.source !== 'MANUAL' && <span className="font-mono rounded-sm border border-border px-1">{label(e.source)}</span>}
                <When v={e.updatedAt} />
              </span>
              <span className="flex gap-0.5 md:opacity-0 group-hover:opacity-100 transition-opacity">
                <Button size="icon" variant="ghost" className="size-7" onClick={() => setDraft({ key: e.key, value: e.isSecret ? '' : (e.value ?? ''), isSecret: e.isSecret, source: e.source, sourceRef: e.sourceRef ?? '', editing: true })} data-testid={`button-edit-config-${e.key}`}><Pencil /></Button>
                <Button size="icon" variant="ghost" className="size-7 hover:text-destructive" disabled={pending} onClick={() => { setRemoving(e.key); onPatch({ remove: [e.key] }, () => setRemoving(null)); }} data-testid={`button-remove-config-${e.key}`}><Trash2 /></Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
