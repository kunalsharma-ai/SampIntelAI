'use client';
import type { UserSummary } from '@si/contracts';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { Table, Td, when } from '@/components/qa/kit';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Card, CardHeader } from '@/components/ui/card';
import { NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';

const CONTROLS: { name: string; done: boolean; note: string }[] = [
  {
    name: 'Tenant isolation by row-level security',
    done: true,
    note: 'Every tenant table is filtered by the database for the request’s workspace; tested in CI.',
  },
  { name: 'Two-step sign-in required', done: true, note: 'TOTP at every sign-in; codes can be used once.' },
  { name: 'Account lockout', done: true, note: 'Five wrong passwords lock an account for 15 minutes.' },
  { name: 'Session revocation', done: true, note: 'Sign-out and disabling an account end sessions at once.' },
  { name: 'Append-only audit log', done: true, note: 'The application role cannot update or delete audit entries.' },
  { name: 'CSRF protection', done: true, note: 'SameSite=Strict cookies plus a required header on every write.' },
  { name: 'Secrets sealed at rest', done: true, note: 'Authenticator secrets are encrypted with AES-256-GCM.' },
  { name: 'Single sign-on (OIDC)', done: false, note: 'Planned before production (ADR-010).' },
  {
    name: 'Authorization enforced at worker level',
    done: true,
    note: 'Scope, expiry, revocation, environment, session cap, window, budget and emergency stop checked before every session.',
  },
  {
    name: 'Outbound URL allowlist',
    done: true,
    note: 'The runner opens and follows redirects only to hosts named in an approved authorization; anything else stops the job.',
  },
  {
    name: 'Separation of duties',
    done: true,
    note: 'Whoever records a survey-owner authorization can never approve it, whatever their role.',
  },
  {
    name: 'Untrusted survey content',
    done: true,
    note: 'Text that tries to instruct a model is flagged and never sent to one; provider keys are sealed and never returned.',
  },
];

export default function SecurityPage() {
  const can = useCan('security.read');
  const canUsers = useCan('users.read');
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ items: UserSummary[] }>('/users?limit=200'),
    enabled: can && canUsers,
  });
  const events = useQuery({
    queryKey: ['qa', 'security-events'],
    queryFn: () => api<{ id: string; kind: string; severity: string; detail: Record<string, unknown>; at: string }[]>('/qa/security-events'),
    enabled: can,
  });
  if (!can) return <NoPermission permission="security.read" />;
  const items = users.data?.items ?? [];
  const pending = items.filter((u) => !u.mfaEnabled && u.status === 'active');
  return (
    <>
      <PageHeader
        title="Security Centre"
        description="Controls in force in this release, and accounts that still need attention."
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Controls" />
          <ul className="divide-y divide-border">
            {CONTROLS.map((c) => (
              <li key={c.name} className="flex items-start gap-3 px-5 py-3">
                {c.done ? (
                  <CheckCircle2 className="mt-0.5 size-4 text-success" aria-label="In force" />
                ) : (
                  <CircleDashed className="mt-0.5 size-4 text-muted" aria-label="Planned" />
                )}
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted">{c.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader
            title="Two-step sign-in not set up"
            description="Active accounts that have never completed enrolment"
          />
          {!canUsers ? (
            <p className="p-5 text-sm text-muted">Needs users.read.</p>
          ) : pending.length ? (
            <ul className="divide-y divide-border">
              {pending.map((u) => (
                <li key={u.id} className="px-5 py-3 text-sm">
                  {u.name}
                  <span className="block text-xs text-muted">{u.email}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-5 text-sm text-muted">Every active account has an authenticator enrolled.</p>
          )}
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Synthetic QA security events" description="Append-only: challenges, blocked navigation, refused hosts, prompt-injection attempts, budget and emergency stops" />
        {!events.data?.length ? (
          <p className="p-5 text-sm text-muted">No events yet.</p>
        ) : (
          <Table head={['When', 'Event', 'Severity', 'Detail']}>
            {events.data.slice(0, 100).map((e) => (
              <tr key={e.id} data-testid="security-event">
                <Td className="text-xs whitespace-nowrap">{when(e.at)}</Td>
                <Td className="text-xs">{e.kind.replaceAll('_', ' ')}</Td>
                <Td>
                  <Badge tone={e.severity === 'high' ? 'danger' : 'warning'}>{e.severity}</Badge>
                </Td>
                <Td className="font-mono text-[11px] text-muted">{JSON.stringify(e.detail)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
