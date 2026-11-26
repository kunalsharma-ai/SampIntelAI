'use client';
import type { AuditEvent, UserSummary } from '@si/contracts';
import { useQuery } from '@tanstack/react-query';
import { Cpu, FlaskConical, KeyRound, Network, PiggyBank, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { useCan, useSession } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Empty, Loading } from '@/components/ui/states';
import { api } from '@/lib/api';
import { MODULES } from '@/lib/modules';
import { useJobs, type AuthView } from '@/components/qa/data';
import { StateBadge, useProjects, when } from '@/components/qa/kit';

function Stat({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: typeof Cpu }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">{label}</p>
        <Icon className="size-4 text-accent" />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </Card>
  );
}

const GUARDRAILS = [
  'Runs only against sandbox and test links unless a verified survey-owner authorization allows a live endpoint.',
  'Stops on any CAPTCHA, security challenge, rejection, unexpected navigation, expiry, budget limit or emergency stop.',
  'No IP rotation, fingerprint spoofing or human-timing imitation. Network metadata is recorded as it is.',
  'Every record is labelled synthetic and never counts toward human quotas, IR, rewards or delivery.',
  'Survey content is treated as untrusted input to the model; secrets never enter a prompt.',
];

export default function Dashboard() {
  const me = useSession();
  const canAudit = useCan('audit.read');
  const canUsers = useCan('users.read');
  const audit = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => api<{ items: AuditEvent[] }>('/audit?limit=8'),
    enabled: canAudit,
  });
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ items: UserSummary[] }>('/users?limit=200'),
    enabled: canUsers,
  });
  const canAuth = useCan('authorizations.read');
  const projects = useProjects();
  const jobs = useJobs();
  const auths = useQuery({ queryKey: ['authorizations'], queryFn: () => api<AuthView[]>('/authorizations'), enabled: canAuth });
  const providers = useQuery({ queryKey: ['ai', 'providers'], queryFn: () => api<{ provider: string; enabled: boolean; model: string }[]>('/ai/providers') });
  const usage = useQuery({ queryKey: ['ai', 'usage'], queryFn: () => api<{ byDay: { costUsd: number }[] }>('/ai/usage') });
  const active = (auths.data ?? []).filter((a) => a.state === 'approved');
  const spend = (usage.data?.byDay ?? []).reduce((n, d) => n + d.costUsd, 0);
  const on = providers.data?.find((p) => p.enabled);
  const ready = MODULES.filter((m) => m.n > 0 && m.ready).map((m) => m.n);

  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="accent">AI QA Dashboard</Badge>}
        title={`Welcome, ${me.user.name.split(' ')[0]}`}
        description="Authorized synthetic research and survey QA. Separate from Supply360: its own data, credentials, queues and limits. Counts here are of synthetic QA records, never human sample."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="QA projects"
          value={String(projects.data?.length ?? '…')}
          hint={`${(projects.data ?? []).reduce((n, p) => n + p.sessions, 0)} synthetic sessions`}
          icon={FlaskConical}
        />
        <Stat
          label="Active authorizations"
          value={canAuth ? String(active.length) : '—'}
          hint={active.length ? `Next expiry ${when([...active].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0]!.expiresAt)}` : 'No survey owner has authorized QA'}
          icon={KeyRound}
        />
        <Stat
          label="Model spend, 30 days"
          value={`$${spend.toFixed(spend < 1 ? 4 : 2)}`}
          hint={on ? `Answering: ${on.provider} (${on.model})` : 'No provider answering; rules only'}
          icon={PiggyBank}
        />
        <Stat
          label="People in this workspace"
          value={users.data ? String(users.data.items.length) : canUsers ? '…' : '—'}
          hint={`${new Set(ready).size} of 19 modules available`}
          icon={Cpu}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Guardrails" description="Built into the execution engine, not left to configuration" />
          <ul className="divide-y divide-border">
            {GUARDRAILS.map((g) => (
              <li key={g} className="flex items-start gap-3 px-5 py-3 text-sm">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                {g}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader
            title="Recent activity"
            description="From the audit log"
            action={
              canAudit && (
                <Link href="/audit" className="text-xs text-accent hover:underline">
                  All
                </Link>
              )
            }
          />
          {!canAudit ? (
            <Empty title="Audit log not available for your role" />
          ) : audit.isLoading ? (
            <Loading />
          ) : audit.data?.items.length ? (
            <ul className="divide-y divide-border">
              {audit.data.items.map((e) => (
                <li key={e.id} className="px-5 py-3">
                  <p className="font-mono text-xs text-text">{e.action}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {e.actorEmail ?? 'system'} · {new Date(e.at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No activity yet" />
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Integration health" />
          <ul className="divide-y divide-border">
            <li className="flex items-start gap-4 px-5 py-4">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2">
                <Network className="size-4 text-muted" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">SampTrek</p>
                  <Badge>Reference only</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  QA projects name the SampTrek project they test. No credentials are held and nothing is written there.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-4 px-5 py-4">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2">
                <Cpu className="size-4 text-muted" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">AI providers</p>
                  {on ? <Badge tone="success">{on.provider}</Badge> : <Badge>None answering</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  FIXTURE answers sandbox runs. Claude, OpenAI and Gemini can be configured; live calls stay off until a key
                  is added and approved.
                </p>
              </div>
            </li>
          </ul>
        </Card>
        <Card>
          <CardHeader
            title="QA executions"
            action={
              <Link href="/executions" className="text-xs text-accent hover:underline">
                Queue
              </Link>
            }
          />
          {!jobs.data?.length ? (
            <CardBody>
              <Empty title="No executions yet">Queue a job from a QA project&apos;s scenarios.</Empty>
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {jobs.data.slice(0, 6).map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span>
                    <span className="font-mono text-xs">{j.projectCode}</span>
                    <span className="block text-xs text-muted">
                      {j.doneSessions} / {j.totalSessions} sessions · {when(j.createdAt)}
                    </span>
                  </span>
                  <StateBadge s={j.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
