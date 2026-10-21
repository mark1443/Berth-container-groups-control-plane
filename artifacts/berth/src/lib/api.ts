import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNowStrict } from 'date-fns';

type ErrLike = { status?: number; data?: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null; message?: string };

export function errStatus(e: unknown): number | undefined {
  return (e as ErrLike | null)?.status;
}
export function errCode(e: unknown): string | undefined {
  return (e as ErrLike | null)?.data?.error?.code;
}
export function errMsg(e: unknown): string {
  const x = e as ErrLike | null;
  return x?.data?.error?.message ?? x?.message ?? 'Something went wrong';
}

export type AccessState = 'ok' | 'forbidden' | 'unauthenticated';
let access: AccessState = 'ok';
const listeners = new Set<() => void>();
export const accessSignal = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  get: () => access,
  set(v: AccessState) {
    if (access === v) return;
    access = v;
    listeners.forEach((l) => l());
  },
};

function watch(e: unknown) {
  const s = errStatus(e);
  if (s === 403 && errCode(e) === 'FORBIDDEN') accessSignal.set('forbidden');
  else if (s === 401) accessSignal.set('unauthenticated');
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: watch }),
  mutationCache: new MutationCache({ onError: watch }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => {
        const s = errStatus(e);
        if (s && s < 500) return false;
        return n < 2;
      },
    },
  },
});

export function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}
export function ago(v: unknown): string {
  const d = toDate(v);
  return d ? `${formatDistanceToNowStrict(d)} ago` : '—';
}
export function stamp(v: unknown, f = 'MMM d, HH:mm:ss'): string {
  const d = toDate(v);
  return d ? format(d, f) : '—';
}
export function duration(a: unknown, b: unknown): string {
  const s = toDate(a);
  const e = toDate(b);
  if (!s || !e) return '—';
  const ms = e.getTime() - s.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export type Tone = 'ok' | 'warn' | 'bad' | 'busy' | 'idle' | 'brand';
const TONES: Record<string, Tone> = {
  ONLINE: 'ok', RUNNING: 'busy', SUCCEEDED: 'ok', APPLIED: 'ok', ENTRY: 'brand',
  DEGRADED: 'warn', DRIFTED: 'warn', RESERVED: 'warn', UNKNOWN: 'warn', EXPOSED: 'busy',
  OFFLINE: 'bad', FAILED: 'bad', MISSING: 'bad', ROLLED_BACK: 'bad',
  STOPPED: 'idle', DRAFT: 'idle', PENDING: 'idle', RELEASED: 'idle', SKIPPED: 'idle', INTERNAL: 'idle',
  APPLYING: 'busy', BERTH: 'brand', UNMANAGED: 'idle',
};
export function toneOf(v: string): Tone {
  return TONES[v] ?? 'idle';
}
export function label(v: string) {
  return v.replace(/_/g, ' ');
}
export const LIVE = new Set(['PENDING', 'RUNNING', 'APPLYING']);
