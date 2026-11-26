'use client';
import { JOB_STOP_LABELS } from '@si/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OctagonX, Play, Plus, RotateCw, ShieldCheck, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useJobs, type Job, type Scenario } from '@/components/qa/data';
import { Field, ProjectPicker, StateBadge, SyntheticBanner, Table, Td, errMsg, useProjects, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Empty, Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

interface Kill {
  on: boolean;
  reason: string | null;
  by: string | null;
  at: string | null;
}
const stopText = (j: Job) =>
  j.stopReason ? (JOB_STOP_LABELS[j.stopReason] ?? j.stopReason.replaceAll('_', ' ')) : j.waitingFor ? `Waiting: ${j.waitingFor.replaceAll('_', ' ')}` : '';

export default function ExecutionsPage() {
  const canRead = useCan('qa_projects.read');
  const canRun = useCan('executions.run');
  const canStop = useCan('executions.emergency_stop');
  const qc = useQueryClient();
  const projects = useProjects();
  const [filter, setFilter] = useState('');
  const jobs = useJobs(filter || undefined);
  const kill = useQuery({ queryKey: ['qa', 'kill'], queryFn: () => api<Kill>('/qa/kill-switch') });
  const [creating, setCreating] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [killing, setKilling] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const pid = projectId || projects.data?.[0]?.id || '';
  const scenarios = useQuery({
    queryKey: ['qa', 'scenarios', pid],
    queryFn: () => api<Scenario[]>(`/qa/scenarios?projectId=${pid}`),
    enabled: creating && !!pid,
  });
  const detail = useQuery({
    queryKey: ['qa', 'job', open],
    queryFn: () => api<Job & { events: { id: string; kind: string; detail: Record<string, unknown>; at: string }[] }>(`/qa/jobs/${open}`),
    enabled: !!open,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['qa'] });
  const create = useMutation({
    mutationFn: (b: unknown) => api<Job>('/qa/jobs', { method: 'POST', body: b }),
    onSuccess: (j) => {
      setCreating(false);
      setPicked([]);
      toast.success(`Job queued: ${j.totalSessions} synthetic sessions`);
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/qa/jobs/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Job cancelled');
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const tick = useMutation({
    mutationFn: () => api<{ sessions: number; jobs: number }>('/qa/tick', { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(`Worker pass: ${r.sessions} session${r.sessions === 1 ? '' : 's'} across ${r.jobs} job${r.jobs === 1 ? '' : 's'}`);
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const setKill = useMutation({
    mutationFn: (b: { on: boolean; reason: string }) => api<Kill & { jobsStopped: number }>('/qa/kill-switch', { method: 'PUT', body: b }),
    onSuccess: (r) => {
      setKilling(false);
      toast.success(r.on ? `Emergency stop on. ${r.jobsStopped} job${r.jobsStopped === 1 ? '' : 's'} stopped.` : 'Emergency stop cleared');
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (!canRead) return <NoPermission permission="qa_projects.read" />;
  const k = kill.data;
  const onCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const at = String(f.get('at') ?? '');
    create.mutate({
      projectId: pid,
      scenarioIds: picked,
      sessionsPerScenario: Number(f.get('n')),
      intervalSeconds: Number(f.get('interval')),
      ...(at ? { scheduledAt: new Date(at).toISOString() } : {}),
    });
  };

  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 3 of 19</Badge>}
        title="AI Execution Engine"
        description="Queue synthetic QA jobs. The worker checks the authorization, hosts, session cap, window, budget and emergency stop before every session, and stops on any security challenge or unexpected navigation."
        actions={
          <>
            {canRun && (
              <Button onClick={() => tick.mutate()} disabled={tick.isPending}>
                <RotateCw /> Run worker pass now
              </Button>
            )}
            {canRun && (
              <Button variant="primary" onClick={() => setCreating(true)} disabled={k?.on}>
                <Plus /> Queue job
              </Button>
            )}
          </>
        }
      />
      <SyntheticBanner />
      <Card className={cn('mb-6', k?.on && 'border-danger/50')}>
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            {k?.on ? <OctagonX className="mt-0.5 size-5 text-danger" /> : <ShieldCheck className="mt-0.5 size-5 text-success" />}
            <div>
              <p className="text-sm font-semibold">{k?.on ? 'Emergency stop is on' : 'Emergency stop is off'}</p>
              <p className="text-xs text-muted">
                {k?.on ? `${k.reason} · by ${k.by} · ${when(k.at)}` : 'Turning it on stops every queued and running synthetic job in this workspace at once.'}
              </p>
            </div>
          </div>
          {canStop && (
            <Button variant={k?.on ? 'secondary' : 'danger'} onClick={() => setKilling(true)}>
              {k?.on ? 'Clear emergency stop' : 'Emergency stop'}
            </Button>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Execution queue" description="Refreshes every 5 seconds" action={<ProjectPicker value={filter} onChange={setFilter} />} />
        {jobs.isLoading ? (
          <Loading />
        ) : !jobs.data?.length ? (
          <Empty title="No jobs yet">Queue a job from a QA project's scenarios.</Empty>
        ) : (
          <Table head={['Job', 'Project', 'State', 'Progress', 'Interval', 'Scheduled', 'Note', '']}>
            {jobs.data.map((j) => (
              <tr key={j.id} data-testid="job-row">
                <Td>
                  <button type="button" className="font-mono text-xs hover:underline" onClick={() => setOpen(j.id)}>
                    {j.id.slice(0, 8)}
                  </button>
                  <p className="text-[11px] text-muted">{j.createdByEmail}</p>
                </Td>
                <Td className="text-xs">
                  <span className="font-mono">{j.projectCode}</span>
                </Td>
                <Td>
                  <StateBadge s={j.status} />
                </Td>
                <Td className="min-w-36">
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full bg-accent" style={{ width: `${(j.doneSessions / j.totalSessions) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-xs tabular-nums">
                    {j.doneSessions} / {j.totalSessions} sessions
                  </p>
                </Td>
                <Td className="text-xs tabular-nums">{j.intervalSeconds ? `${j.intervalSeconds} s` : 'none'}</Td>
                <Td className="text-xs whitespace-nowrap">{when(j.scheduledAt)}</Td>
                <Td className={cn('text-xs', j.stopReason && j.status !== 'cancelled' ? 'text-danger' : 'text-muted')}>{stopText(j)}</Td>
                <Td className="text-right">
                  {canRun && (j.status === 'queued' || j.status === 'running') && (
                    <Button size="sm" variant="ghost" onClick={() => cancel.mutate(j.id)}>
                      <X /> Cancel
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog open={creating} onOpenChange={setCreating} title="Queue a QA job" description="Each scenario runs the given number of sessions. Sessions count against the authorization's cap." wide>
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="QA project" htmlFor="j-project">
              <ProjectPicker id="j-project" value={pid} onChange={(v) => { setProjectId(v); setPicked([]); }} allowAll={false} />
            </Field>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-xs font-medium text-muted">Scenarios</legend>
            {scenarios.isLoading ? (
              <Loading />
            ) : !scenarios.data?.length ? (
              <p className="text-sm text-muted">This project has no scenarios yet.</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {scenarios.data.map((s) => (
                  <label key={s.id} className={cn('flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm', picked.includes(s.id) && 'border-accent/50 bg-accent/10')}>
                    <input type="checkbox" className="accent-[var(--accent)]" checked={picked.includes(s.id)} onChange={() => setPicked(picked.includes(s.id) ? picked.filter((x) => x !== s.id) : [...picked, s.id])} />
                    {s.name}
                  </label>
                ))}
                <button type="button" className="text-left text-xs text-accent hover:underline" onClick={() => setPicked(scenarios.data!.map((s) => s.id))}>
                  Select all
                </button>
              </div>
            )}
          </fieldset>
          <Field label="Sessions per scenario" htmlFor="j-n">
            <Input id="j-n" name="n" type="number" min={1} max={50} defaultValue={2} />
          </Field>
          <Field label="Seconds between sessions" htmlFor="j-interval" hint="Interval Controller: fixed, never randomised">
            <Input id="j-interval" name="interval" type="number" min={0} max={3600} defaultValue={0} />
          </Field>
          <Field label="Start at (optional)" htmlFor="j-at" hint="Runs only inside the authorization's windows">
            <Input id="j-at" name="at" type="datetime-local" />
          </Field>
          <div className="flex items-end justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!picked.length || create.isPending}>
              <Play /> Queue
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={killing} onOpenChange={setKilling} title={k?.on ? 'Clear the emergency stop' : 'Emergency stop'} description={k?.on ? 'Jobs that were stopped stay stopped; queue new ones afterwards.' : 'Every queued and running synthetic job stops now.'}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setKill.mutate({ on: !k?.on, reason: String(new FormData(e.currentTarget).get('reason')) });
          }}
          className="space-y-4"
        >
          <Field label="Reason" htmlFor="k-reason">
            <Input id="k-reason" name="reason" required minLength={3} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant={k?.on ? 'primary' : 'danger'} disabled={setKill.isPending}>
              {k?.on ? 'Clear' : 'Stop everything'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="Job events" description="Append-only log of what the worker did" wide>
        {detail.isLoading ? (
          <Loading />
        ) : (
          <ol className="max-h-[60vh] space-y-1.5 overflow-y-auto text-xs">
            {detail.data?.events.map((e) => (
              <li key={e.id} className="flex gap-3 border-b border-border pb-1.5">
                <span className="w-40 shrink-0 text-muted">{when(e.at)}</span>
                <span className="font-mono">{e.kind}</span>
                <span className="truncate font-mono text-muted">{JSON.stringify(e.detail)}</span>
              </li>
            ))}
          </ol>
        )}
      </Dialog>
    </>
  );
}
