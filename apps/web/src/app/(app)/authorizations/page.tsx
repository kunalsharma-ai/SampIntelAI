'use client';
import { ENVIRONMENT_LABELS, QA_FIXTURE_HOST, QaEnvironment } from '@si/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, KeyRound, Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Field, StateBadge, Table, Td, errMsg, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan, useSession } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Empty, ErrorState, Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';
import { DAYS, windowText, type AuthView } from '@/components/qa/data';

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export default function AuthorizationsPage() {
  const me = useSession();
  const canRead = useCan('authorizations.read');
  const canRequest = useCan('authorizations.request');
  const canDecide = useCan('authorizations.manage');
  const canRevoke = useCan('authorizations.revoke');
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ a: AuthView; d: 'approve' | 'reject' } | null>(null);
  const [revoking, setRevoking] = useState<AuthView | null>(null);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [envs, setEnvs] = useState<string[]>(['sandbox']);

  const list = useQuery({ queryKey: ['authorizations'], queryFn: () => api<AuthView[]>('/authorizations'), enabled: canRead });
  const done = (m: string) => {
    toast.success(m);
    void qc.invalidateQueries({ queryKey: ['authorizations'] });
    void qc.invalidateQueries({ queryKey: ['qa'] });
  };
  const create = useMutation({
    mutationFn: (b: unknown) => api<AuthView>('/authorizations', { method: 'POST', body: b }),
    onSuccess: () => {
      setCreating(false);
      done('Authorization recorded. Someone other than you must now approve it.');
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: string; reason: string }) =>
      api(`/authorizations/${v.id}/decision`, { method: 'POST', body: { decision: v.decision, reason: v.reason } }),
    onSuccess: (_d, v) => {
      setDeciding(null);
      done(v.decision === 'approve' ? 'Authorization approved' : 'Authorization rejected');
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const revoke = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      api<{ jobsStopped: number }>(`/authorizations/${v.id}/revoke`, { method: 'POST', body: { reason: v.reason } }),
    onSuccess: (r) => {
      setRevoking(null);
      done(`Authorization revoked. ${r.jobsStopped} job${r.jobsStopped === 1 ? '' : 's'} stopped.`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (!canRead) return <NoPermission permission="authorizations.read" />;

  const onCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '');
    create.mutate({
      surveyOwner: s('owner'),
      ownerContact: s('contact'),
      evidenceRef: s('evidence'),
      purpose: s('purpose'),
      environments: envs,
      allowedHosts: s('hosts').split(/[\s,]+/).filter(Boolean),
      maxSessions: Number(s('max')),
      windows: [{ days, start: s('start'), end: s('end') === '23:59' ? '24:00' : s('end') }],
      timezone: s('tz'),
      startsAt: new Date(s('startsAt')).toISOString(),
      expiresAt: new Date(s('expiresAt')).toISOString(),
      classification: 'synthetic_qa',
      exportQuestionContent: f.get('content') === 'on',
    });
  };
  const rows = list.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 18 of 19</Badge>}
        title="Authorization Centre"
        description="Synthetic QA runs only inside a survey owner's written authorization: its hosts, environments, session cap, windows and expiry. Whoever records an authorization cannot approve it."
        actions={
          canRequest && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus /> Record authorization
            </Button>
          )
        }
      />
      <Card>
        <CardHeader title="Authorizations" description="Checked by the worker before every session, whatever the screen shows" />
        {list.isLoading ? (
          <Loading />
        ) : list.error ? (
          <ErrorState error={list.error} />
        ) : !rows.length ? (
          <Empty title="No authorizations yet">Record the survey owner's authorization first. QA projects need an approved one.</Empty>
        ) : (
          <Table head={['Survey owner', 'State', 'Scope', 'Sessions', 'Valid', 'Recorded and decided', '']}>
            {rows.map((a) => (
              <tr key={a.id} data-testid="auth-row">
                <Td>
                  <p className="font-medium">{a.surveyOwner}</p>
                  <p className="text-xs text-muted">{a.ownerContact}</p>
                  <p className="font-mono text-[11px] text-muted">{a.evidenceRef}</p>
                </Td>
                <Td>
                  <StateBadge s={a.state} />
                </Td>
                <Td className="text-xs">
                  <p>{a.environments.map((e) => ENVIRONMENT_LABELS[e as QaEnvironment] ?? e).join(', ')}</p>
                  <p className="font-mono text-muted">{a.allowedHosts.join(', ')}</p>
                  {a.windows.map((w, i) => (
                    <p key={i} className="text-muted">
                      {windowText(w)} ({a.timezone})
                    </p>
                  ))}
                </Td>
                <Td className="tabular-nums">
                  {a.sessionsUsed} / {a.maxSessions}
                </Td>
                <Td className="text-xs whitespace-nowrap">
                  {when(a.startsAt)}
                  <br />
                  to {when(a.expiresAt)}
                </Td>
                <Td className="text-xs">
                  <p>By {a.requestedByEmail}</p>
                  {a.decidedByEmail && (
                    <p className="text-muted">
                      {a.state === 'rejected' ? 'Rejected' : 'Approved'} by {a.decidedByEmail}: {a.decisionReason}
                    </p>
                  )}
                  {a.revokedAt && <p className="text-danger">Revoked: {a.revokeReason}</p>}
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {a.state === 'pending' && canDecide && a.requestedBy !== me.user.id && (
                    <>
                      <Button size="sm" variant="primary" onClick={() => setDeciding({ a, d: 'approve' })}>
                        <Check /> Approve
                      </Button>{' '}
                      <Button size="sm" variant="ghost" onClick={() => setDeciding({ a, d: 'reject' })}>
                        <X /> Reject
                      </Button>
                    </>
                  )}
                  {a.state === 'pending' && a.requestedBy === me.user.id && (
                    <span className="text-xs text-muted">Waiting for someone else to decide</span>
                  )}
                  {(a.state === 'approved' || a.state === 'pending') && canRevoke && (
                    <Button size="sm" variant="danger" className="ml-1" onClick={() => setRevoking(a)}>
                      <Ban /> Revoke
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Dialog open={creating} onOpenChange={setCreating} title="Record a survey-owner authorization" description="What the owner agreed to, in writing. It stays pending until a different person approves it." wide>
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <Field label="Survey owner" htmlFor="a-owner">
            <Input id="a-owner" name="owner" required defaultValue="DEMO Survey Owner Ltd" />
          </Field>
          <Field label="Who authorized it (name and role)" htmlFor="a-contact">
            <Input id="a-contact" name="contact" required defaultValue="DEMO Head of Research" />
          </Field>
          <Field label="Evidence reference" htmlFor="a-evidence" hint="Contract, SOW or ticket where the signed authorization lives">
            <Input id="a-evidence" name="evidence" required defaultValue="DEMO-SOW-2026-114" />
          </Field>
          <Field label="Session cap" htmlFor="a-max">
            <Input id="a-max" name="max" type="number" min={1} max={10000} required defaultValue={200} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Purpose" htmlFor="a-purpose">
              <Input id="a-purpose" name="purpose" required defaultValue="Test survey logic, redirects and version regressions on sandbox fixtures" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Allowed hosts" htmlFor="a-hosts" hint="Only these hosts may be opened, including redirects. Comma separated.">
              <Input id="a-hosts" name="hosts" required defaultValue={QA_FIXTURE_HOST} className="font-mono" />
            </Field>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-xs font-medium text-muted">Environments</legend>
            <div className="flex flex-wrap gap-2">
              {QaEnvironment.options.map((e) => (
                <label key={e} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={envs.includes(e)} onChange={() => setEnvs(envs.includes(e) ? envs.filter((x) => x !== e) : [...envs, e])} />
                  {ENVIRONMENT_LABELS[e]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-xs font-medium text-muted">Execution window days</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={days.includes(i)} onChange={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())} />
                  {d}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Window starts" htmlFor="a-start">
            <Input id="a-start" name="start" type="time" required defaultValue="00:00" />
          </Field>
          <Field label="Window ends" htmlFor="a-end">
            <Input id="a-end" name="end" type="time" required defaultValue="23:59" />
          </Field>
          <Field label="Timezone" htmlFor="a-tz">
            <Input id="a-tz" name="tz" required defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} />
          </Field>
          <div />
          <Field label="Valid from" htmlFor="a-from">
            <Input id="a-from" name="startsAt" type="datetime-local" required defaultValue={local(new Date())} />
          </Field>
          <Field label="Expires" htmlFor="a-to">
            <Input id="a-to" name="expiresAt" type="datetime-local" required defaultValue={local(new Date(Date.now() + 30 * 86_400_000))} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="content" className="accent-[var(--accent)]" /> The owner allows question wording in exports
          </label>
          <p className="flex items-center gap-2 text-xs text-muted sm:col-span-2">
            <KeyRound className="size-3.5" /> Classification is fixed to synthetic QA. Live runs also need an approved driver, which this release does not have.
          </p>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              Record for approval
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={!!deciding}
        onOpenChange={(o) => !o && setDeciding(null)}
        title={deciding?.d === 'approve' ? 'Approve authorization' : 'Reject authorization'}
        description={deciding ? `${deciding.a.surveyOwner}, recorded by ${deciding.a.requestedByEmail}` : undefined}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get('reason'));
            if (deciding) decide.mutate({ id: deciding.a.id, decision: deciding.d, reason });
          }}
          className="space-y-4"
        >
          <Field label="Reason" htmlFor="d-reason">
            <Input id="d-reason" name="reason" required minLength={3} defaultValue={deciding?.d === 'approve' ? 'Signed authorization checked' : ''} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant={deciding?.d === 'approve' ? 'primary' : 'danger'} disabled={decide.isPending}>
              {deciding?.d === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)} title="Revoke authorization" description="Every queued or running job under it stops at once.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get('reason'));
            if (revoking) revoke.mutate({ id: revoking.id, reason });
          }}
          className="space-y-4"
        >
          <Field label="Reason" htmlFor="r-reason">
            <Input id="r-reason" name="reason" required minLength={3} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="danger" disabled={revoke.isPending}>
              Revoke now
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
