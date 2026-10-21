import { Link } from 'wouter';
import { Anchor, ArrowRightLeft, Boxes, Cable, CircleAlert, KeyRound, Play, Radar, Server, Trash2, UserPlus, Waves } from 'lucide-react';
import type { ActivityEvent } from '@workspace/api-client-react';
import { label, stamp } from '@/lib/api';
import { cn } from '@/lib/utils';
import { When } from '@/components/berth';

const ICONS: Record<string, { i: typeof Server; t: string }> = {
  PROVIDER_REGISTERED: { i: Server, t: 'ok' }, PROVIDER_UPDATED: { i: Server, t: 'idle' }, PROVIDER_REMOVED: { i: Trash2, t: 'bad' },
  PROVIDER_STATUS_CHANGED: { i: Waves, t: 'warn' }, DISCOVERY_COMPLETED: { i: Radar, t: 'busy' }, WORKLOAD_MISSING: { i: CircleAlert, t: 'bad' },
  GROUP_CREATED: { i: Anchor, t: 'brand' }, GROUP_UPDATED: { i: Anchor, t: 'idle' }, GROUP_DELETED: { i: Trash2, t: 'bad' },
  MEMBER_ADDED: { i: UserPlus, t: 'ok' }, MEMBER_UPDATED: { i: Boxes, t: 'idle' }, MEMBER_REMOVED: { i: Trash2, t: 'idle' },
  PORT_RESERVED: { i: Cable, t: 'warn' }, PORT_RELEASED: { i: Cable, t: 'idle' }, CONFIG_CHANGED: { i: KeyRound, t: 'idle' },
  OPERATION_CREATED: { i: Play, t: 'busy' }, OPERATION_FINISHED: { i: ArrowRightLeft, t: 'ok' }, DRIFT_DETECTED: { i: Waves, t: 'warn' },
};

export function EventRow({ e, i = 0, compact }: { e: ActivityEvent; i?: number; compact?: boolean }) {
  const ic = ICONS[e.kind] ?? { i: CircleAlert, t: 'idle' };
  const keys = Object.keys(e.details ?? {}).slice(0, 4);
  return (
    <li className="group flex gap-3 px-4 py-2.5 row-hover rise" style={{ animationDelay: `${Math.min(i, 20) * 22}ms` }} data-testid={`row-event-${e.id}`}>
      <span className={cn('mt-0.5 grid place-items-center size-6 rounded shrink-0', `tone-${ic.t}`, 'bg-[hsl(var(--t)/.1)] text-[hsl(var(--t))]')}>
        <ic.i className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug">{e.message}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="font-mono tracking-wide">{label(e.kind)}</span>
          {e.actor && <span>by {e.actor}</span>}
          {e.groupId && <Link href={`/groups/${e.groupId}`} className="hover:text-primary underline-offset-2 hover:underline">berth</Link>}
          {e.providerId && <Link href={`/providers/${e.providerId}`} className="hover:text-primary underline-offset-2 hover:underline">provider</Link>}
          {e.operationId && <Link href={`/operations/${e.operationId}`} className="hover:text-primary underline-offset-2 hover:underline">operation</Link>}
          {!compact && keys.length > 0 && <span className="font-mono truncate">{keys.map((k) => `${k}=${fmt(e.details[k])}`).join('  ')}</span>}
        </div>
      </div>
      <div className="text-right text-[11px] text-muted-foreground shrink-0">
        <When v={e.at} />
        {!compact && <div className="font-mono text-[10px] opacity-70">{stamp(e.at, 'HH:mm:ss')}</div>}
      </div>
    </li>
  );
}

function fmt(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') return Array.isArray(v) ? `[${v.length}]` : '{…}';
  const s = String(v);
  return s.length > 28 ? `${s.slice(0, 26)}…` : s;
}
