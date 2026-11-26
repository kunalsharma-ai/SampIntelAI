'use client';
import { SYNTHETIC_OUTCOME_LABELS, type SyntheticOutcome } from '@si/contracts';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

export const errMsg = (e: unknown) => (e instanceof ApiError ? (e.problem.detail ?? e.message) : 'Request failed');
export const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '—');
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`);
export const secs = (n: number | null | undefined) => (n == null ? '—' : n >= 120 ? `${(n / 60).toFixed(1)} min` : `${n} s`);

export interface QaProject {
  id: string;
  code: string;
  name: string;
  samptrekProjectRef: string | null;
  authorizationId: string;
  environment: string;
  status: 'active' | 'paused' | 'closed';
  gateUrl: string | null;
  clientUrl: string;
  expectedLoiMinutes: number | null;
  expectedIrPercent: number | null;
  createdAt: string;
  authorization: { state: string; surveyOwner: string; expiresAt: string };
  sessions: number;
  scenarios: number;
}

export function useProjects() {
  return useQuery({ queryKey: ['qa', 'projects'], queryFn: () => api<QaProject[]>('/qa/projects') });
}

/** Every synthetic screen carries this, so no one mistakes a synthetic record for human sample. */
export function SyntheticBanner({ children }: { children?: ReactNode }) {
  return (
    <div
      role="note"
      className="mb-5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-xs text-warning"
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">Synthetic QA data.</strong> Fictional profiles on approved test surveys. Never
        counted in human quotas, IR, rewards, invoices or sample delivery.{children ? <> {children}</> : null}
      </span>
    </div>
  );
}

export function ProjectPicker({
  value,
  onChange,
  allowAll = true,
  id = 'project-picker',
}: {
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
  id?: string;
}) {
  const p = useProjects();
  return (
    <Select id={id} aria-label="QA project" value={value} onChange={(e) => onChange(e.target.value)} className="w-auto min-w-56">
      {allowAll && <option value="">All QA projects</option>}
      {(p.data ?? []).map((x) => (
        <option key={x.id} value={x.id}>
          {x.code} · {x.name}
        </option>
      ))}
    </Select>
  );
}

const OUTCOME_TONE: Record<string, 'success' | 'warning' | 'danger' | 'accent' | 'neutral'> = {
  complete: 'success',
  terminate: 'warning',
  quota_full: 'warning',
  timeout: 'danger',
  error: 'danger',
  security_stop: 'danger',
  navigation_stop: 'danger',
};
export function OutcomeBadge({ o }: { o: string }) {
  return <Badge tone={OUTCOME_TONE[o] ?? 'neutral'}>{SYNTHETIC_OUTCOME_LABELS[o as SyntheticOutcome] ?? o}</Badge>;
}

const STATE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'accent'> = {
  approved: 'success',
  pending: 'accent',
  rejected: 'danger',
  revoked: 'danger',
  expired: 'warning',
  queued: 'accent',
  running: 'accent',
  finished: 'success',
  stopped: 'danger',
  failed: 'danger',
  cancelled: 'neutral',
  active: 'success',
  paused: 'warning',
  closed: 'neutral',
};
export function StateBadge({ s }: { s: string }) {
  return <Badge tone={STATE_TONE[s] ?? 'neutral'}>{s.replaceAll('_', ' ')}</Badge>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'danger' | 'success' }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn('mt-1.5 text-2xl font-semibold tabular-nums', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success')}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    // Focusable so keyboard users can scroll a wide table (WCAG 2.1.1).
    <div className="overflow-x-auto" tabIndex={0}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cn('px-4 py-2.5 align-top', className)}>{children}</td>
);

export function Bars({ rows, unit = '' }: { rows: { label: string; n: number }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-3 text-xs">
          <span className="w-28 shrink-0 truncate text-muted">{r.label}</span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${(r.n / max) * 100}%` }} />
          </span>
          <span className="w-14 text-right tabular-nums">
            {r.n}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  );
}

export const Field = ({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: ReactNode }) => (
  <div>
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted">
      {label}
    </label>
    {children}
    {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
  </div>
);
