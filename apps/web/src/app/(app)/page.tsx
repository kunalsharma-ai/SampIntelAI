'use client';
import type { AuditEvent, UserSummary } from '@si/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Ban,
  Bot,
  Cpu,
  EyeOff,
  FlaskConical,
  KeyRound,
  Network,
  PiggyBank,
  PlayCircle,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CountUp } from '@/components/fun/count-up';
import { FunSwitch } from '@/components/fun/fun-switch';
import { FunTabs } from '@/components/fun/fun-tabs';
import { HeroScene } from '@/components/fun/hero-scene';
import { ProgressRing } from '@/components/fun/progress-ring';
import { Tilt } from '@/components/fun/tilt';
import { useTheme } from '@/components/providers';
import { ModuleIcon } from '@/components/shell/icons';
import { useCan, useSession } from '@/components/session';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Empty, Loading } from '@/components/ui/states';
import { api } from '@/lib/api';
import { MODULES } from '@/lib/modules';
import { useJobs, type AuthView } from '@/components/qa/data';
import { StateBadge, useProjects, when } from '@/components/qa/kit';

const TINTS = {
  violet: 'from-violet-500 to-fuchsia-500',
  sky: 'from-sky-400 to-indigo-500',
  mint: 'from-emerald-400 to-teal-500',
  sun: 'from-amber-400 to-orange-500',
  pink: 'from-pink-400 to-rose-500',
} as const;
type Tint = keyof typeof TINTS;
const CYCLE: Tint[] = ['violet', 'sky', 'pink', 'mint', 'sun'];

function IconTile({ icon: Icon, tint, className }: { icon: LucideIcon; tint: Tint; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_3px_0_rgb(0_0_0/0.15),0_10px_18px_-8px_rgb(0_0_0/0.4)]',
        TINTS[tint],
        className,
      )}
    >
      <Icon className="size-5" />
    </span>
  );
}

function Stat({
  label,
  value,
  hint,
  icon,
  tint,
  progress,
  delay,
}: {
  label: string;
  value: ReactNode;
  hint: string;
  icon: LucideIcon;
  tint: Tint;
  progress?: number | null;
  delay: number;
}) {
  return (
    <Tilt className="fun-pop" style={{ ['--d' as string]: `${delay}ms` }}>
      <Card className="fun-wiggle relative h-full overflow-hidden p-5">
        <span
          aria-hidden
          className={cn(
            'absolute -top-10 -right-10 size-32 rounded-full bg-gradient-to-br opacity-15 blur-xl',
            TINTS[tint],
          )}
        />
        <div className="flex min-h-12 items-start justify-between gap-3">
          <IconTile icon={icon} tint={tint} />
          {progress != null && (
            <ProgressRing value={progress} id={`ring-${tint}`} size={48} stroke={6}>
              {Math.round(progress * 100)}%
            </ProgressRing>
          )}
        </div>
        <p className="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
        <p className="mt-1 text-3xl font-extrabold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted">{hint}</p>
      </Card>
    </Tilt>
  );
}

function Hero({ name, children }: { name: string; children: ReactNode }) {
  const { motion, setMotion } = useTheme();
  return (
    <section className="fun-pop relative mb-6 overflow-hidden rounded-3xl border border-border bg-surface px-6 py-6 md:px-8">
      <div
        aria-hidden
        className="fun-shine absolute inset-0 bg-[linear-gradient(110deg,rgb(167_139_250/0.22),rgb(244_114_182/0.18),rgb(251_191_36/0.18),rgb(52_211_153/0.18),rgb(56_189_248/0.22))]"
      />
      <div className="relative grid items-center gap-4 md:grid-cols-[1.2fr_1fr]">
        <div>
          <Badge tone="accent" className="gap-1.5">
            <Sparkles className="size-3" aria-hidden /> AI QA Dashboard
          </Badge>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
            Welcome,{' '}
            <span className="bg-gradient-to-r from-violet-700 via-fuchsia-700 to-orange-700 bg-clip-text text-transparent">
              {name}
            </span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Authorized synthetic research and survey QA. Separate from Supply360: its own data, credentials, queues and
            limits. Counts here are of synthetic QA records, never human sample.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4">{children}</div>
          <FunSwitch className="mt-4" checked={motion} onCheckedChange={setMotion} label="Motion effects" />
        </div>
        <HeroScene />
      </div>
    </section>
  );
}

const GUARDRAILS: { text: string; icon: LucideIcon }[] = [
  {
    text: 'Runs only against sandbox and test links unless a verified survey-owner authorization allows a live endpoint.',
    icon: KeyRound,
  },
  {
    text: 'Stops on any CAPTCHA, security challenge, rejection, unexpected navigation, expiry, budget limit or emergency stop.',
    icon: Ban,
  },
  {
    text: 'No IP rotation, fingerprint spoofing or human-timing imitation. Network metadata is recorded as it is.',
    icon: EyeOff,
  },
  {
    text: 'Every record is labelled synthetic and never counts toward human quotas, IR, rewards or delivery.',
    icon: Tag,
  },
  {
    text: 'Survey content is treated as untrusted input to the model; secrets never enter a prompt.',
    icon: ShieldCheck,
  },
];

const LAUNCH = ['qa-projects', 'execution', 'synthetic', 'quality', 'excel', 'providers'];

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
  const auths = useQuery({
    queryKey: ['authorizations'],
    queryFn: () => api<AuthView[]>('/authorizations'),
    enabled: canAuth,
  });
  const providers = useQuery({
    queryKey: ['ai', 'providers'],
    queryFn: () => api<{ provider: string; enabled: boolean; model: string }[]>('/ai/providers'),
  });
  const usage = useQuery({
    queryKey: ['ai', 'usage'],
    queryFn: () => api<{ byDay: { costUsd: number }[] }>('/ai/usage'),
  });
  const active = (auths.data ?? []).filter((a) => a.state === 'approved');
  const spend = (usage.data?.byDay ?? []).reduce((n, d) => n + d.costUsd, 0);
  const on = providers.data?.find((p) => p.enabled);
  const ready = MODULES.filter((m) => m.n > 0 && m.ready).map((m) => m.n);

  const jobList = !jobs.data?.length ? (
    <CardBody>
      <Empty title="No executions yet">Queue a job from a QA project&apos;s scenarios.</Empty>
    </CardBody>
  ) : (
    <ul className="grid gap-3 p-4 md:grid-cols-2">
      {jobs.data.slice(0, 6).map((j, i) => (
        <li key={j.id} className="fun-pop" style={{ ['--d' as string]: `${i * 60}ms` }}>
          <Link
            href="/executions"
            className="fun-wiggle flex items-center gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3 transition-transform hover:-translate-y-0.5 hover:border-accent/40"
          >
            <ProgressRing
              value={j.totalSessions ? j.doneSessions / j.totalSessions : 0}
              id={`job-${j.id}`}
              size={44}
              stroke={5}
            >
              {j.totalSessions ? Math.round((j.doneSessions / j.totalSessions) * 100) : 0}%
            </ProgressRing>
            <span className="min-w-0 flex-1">
              <span className="font-mono text-xs font-semibold">{j.projectCode}</span>
              <span className="block text-xs text-muted">
                {j.doneSessions} / {j.totalSessions} sessions · {when(j.createdAt)}
              </span>
            </span>
            <StateBadge s={j.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
  const activityList = !canAudit ? (
    <Empty title="Audit log not available for your role" />
  ) : audit.isLoading ? (
    <Loading />
  ) : audit.data?.items.length ? (
    <ol className="relative mx-5 my-4 space-y-4 border-l-2 border-dashed border-border pl-5">
      {audit.data.items.map((e, i) => (
        <li key={e.id} className="fun-pop relative" style={{ ['--d' as string]: `${i * 50}ms` }}>
          <span
            aria-hidden
            className={cn(
              'absolute top-1 -left-[29px] size-3.5 rounded-full bg-gradient-to-br ring-4 ring-surface',
              TINTS[CYCLE[i % CYCLE.length]!],
            )}
          />
          <p className="font-mono text-xs font-semibold text-text">{e.action}</p>
          <p className="mt-0.5 text-xs text-muted">
            {e.actorEmail ?? 'system'} · {new Date(e.at).toLocaleString()}
          </p>
        </li>
      ))}
    </ol>
  ) : (
    <Empty title="No activity yet" />
  );
  const integrations = [
    {
      name: 'SampTrek',
      icon: Network,
      badge: <Badge>Reference only</Badge>,
      note: 'QA projects name the SampTrek project they test. No credentials are held and nothing is written there.',
    },
    {
      name: 'AI providers',
      icon: Cpu,
      badge: on ? <Badge tone="success">{on.provider}</Badge> : <Badge>None answering</Badge>,
      note: 'FIXTURE answers sandbox runs. Claude, OpenAI and Gemini can be configured; live calls stay off until a key is added and approved.',
    },
  ];
  const launch = MODULES.filter((m) => LAUNCH.includes(m.key) && m.ready && me.permissions.includes(m.permission));
  const sessions = (projects.data ?? []).reduce((n, p) => n + p.sessions, 0);
  const people = users.data?.items.length;
  const modulesReady = new Set(ready).size;

  return (
    <>
      <Hero name={me.user.name.split(' ')[0] ?? ''}>
        <Link
          href="/qa-projects"
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-contrast"
        >
          <FlaskConical className="size-4" aria-hidden /> Open QA projects
        </Link>
        <Link
          href="/executions"
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-5 text-sm font-semibold hover:bg-surface-2"
        >
          <PlayCircle className="size-4 text-accent" aria-hidden /> Execution queue
        </Link>
      </Hero>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="QA projects"
          value={projects.data ? <CountUp value={projects.data.length} /> : '…'}
          hint={`${sessions} synthetic sessions`}
          icon={FlaskConical}
          tint="violet"
          delay={0}
        />
        <Stat
          label="Active authorizations"
          value={canAuth ? <CountUp value={active.length} /> : '—'}
          hint={
            active.length
              ? `Next expiry ${when([...active].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0]!.expiresAt)}`
              : 'No survey owner has authorized QA'
          }
          icon={KeyRound}
          tint="pink"
          delay={80}
        />
        <Stat
          label="Model spend, 30 days"
          value={`$${spend.toFixed(spend < 1 ? 4 : 2)}`}
          hint={on ? `Answering: ${on.provider} (${on.model})` : 'No provider answering; rules only'}
          icon={PiggyBank}
          tint="sun"
          delay={160}
        />
        <Stat
          label="People in this workspace"
          value={people !== undefined ? <CountUp value={people} /> : canUsers ? '…' : '—'}
          hint={`${modulesReady} of 19 modules available`}
          icon={Bot}
          tint="mint"
          progress={modulesReady / 19}
          delay={240}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-accent" aria-hidden /> Guardrails
              </span>
            }
            description="Built into the execution engine, not left to configuration"
          />
          <ul className="grid gap-3 p-4 md:grid-cols-2">
            {GUARDRAILS.map((g, i) => (
              <li
                key={g.text}
                className={cn('fun-pop', i === GUARDRAILS.length - 1 && 'md:col-span-2')}
                style={{ ['--d' as string]: `${i * 60}ms` }}
              >
                <div className="fun-wiggle flex h-full items-start gap-3 rounded-2xl border border-border bg-surface-2 p-3 text-sm">
                  <IconTile
                    icon={g.icon}
                    tint={CYCLE[i % CYCLE.length]!}
                    className="size-9 rounded-xl [&_svg]:size-4"
                  />
                  <span className="pt-1">{g.text}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Integration health" description="Every outside system this workspace touches" />
          <ul className="space-y-3 p-4">
            {integrations.map((i, n) => (
              <li key={i.name}>
                <Tilt max={8}>
                  <div className="fun-wiggle flex flex-col gap-2 rounded-2xl border border-border bg-surface-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <IconTile icon={i.icon} tint={n ? 'sky' : 'violet'} />
                      {i.badge}
                    </div>
                    <p className="text-base font-bold">{i.name}</p>
                    <p className="text-xs text-muted">{i.note}</p>
                  </div>
                </Tilt>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {launch.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Sparkles className="size-4 text-accent" aria-hidden /> Quick launch
              </span>
            }
            description="Jump straight into the tools you use most"
          />
          <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
            {launch.map((m, i) => (
              <li key={m.key} className="fun-pop" style={{ ['--d' as string]: `${i * 50}ms` }}>
                <Link
                  href={m.href}
                  className="fun-wiggle flex h-full flex-col items-center gap-2 rounded-2xl border border-border bg-surface-2 px-2 py-4 text-center text-xs font-semibold transition-transform hover:-translate-y-1 hover:border-accent/40"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-12 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_3px_0_rgb(0_0_0/0.15),0_10px_18px_-8px_rgb(0_0_0/0.4)]',
                      TINTS[CYCLE[i % CYCLE.length]!],
                    )}
                  >
                    <ModuleIcon k={m.key} className="size-5" />
                  </span>
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-6">
        <FunTabs
          label="QA overview"
          tabs={[
            {
              value: 'jobs',
              label: 'QA executions',
              icon: PlayCircle,
              tint: TINTS.violet,
              count: jobs.data?.length,
              content: (
                <>
                  <p className="px-5 pt-3 text-xs text-muted">
                    Synthetic QA runs, newest first.{' '}
                    <Link href="/executions" className="font-semibold text-accent hover:underline">
                      Queue
                    </Link>
                  </p>
                  {jobList}
                </>
              ),
            },
            {
              value: 'activity',
              label: 'Recent activity',
              icon: Activity,
              tint: TINTS.pink,
              content: (
                <>
                  <p className="px-5 pt-3 text-xs text-muted">
                    From the audit log.{' '}
                    {canAudit && (
                      <Link href="/audit" className="font-semibold text-accent hover:underline">
                        All activity
                      </Link>
                    )}
                  </p>
                  {activityList}
                </>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
