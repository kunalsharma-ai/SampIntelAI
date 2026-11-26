'use client';
import {
  ENVIRONMENT_LABELS,
  LANGUAGE_LABELS,
  OBJECTIVE_LABELS,
  OBJECTIVES,
  QA_LANGUAGES,
  QaEnvironment,
  SYNTHETIC_OUTCOMES,
  SYNTHETIC_OUTCOME_LABELS,
  TIMING_LABELS,
  TIMINGS,
} from '@si/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pause, Play, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Field, StateBadge, SyntheticBanner, Table, Td, errMsg, useProjects, type QaProject } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Empty, ErrorState, Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useFixtures, type AuthView, type Profile, type Scenario } from '@/components/qa/data';

export default function QaProjectsPage() {
  const canRead = useCan('qa_projects.read');
  const canManage = useCan('qa_projects.manage');
  const canScenarios = useCan('scenarios.manage');
  const qc = useQueryClient();
  const projects = useProjects();
  const [sel, setSel] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [versioning, setVersioning] = useState<QaProject | null>(null);
  const fixtures = useFixtures();
  const auths = useQuery({ queryKey: ['authorizations'], queryFn: () => api<AuthView[]>('/authorizations'), enabled: canManage });
  const profiles = useQuery({ queryKey: ['qa', 'profiles'], queryFn: () => api<Profile[]>('/qa/profiles') });
  const current = projects.data?.find((p) => p.id === sel) ?? projects.data?.[0];
  const scenarios = useQuery({
    queryKey: ['qa', 'scenarios', current?.id],
    queryFn: () => api<Scenario[]>(`/qa/scenarios?projectId=${current!.id}`),
    enabled: !!current,
  });
  const done = (m: string) => {
    toast.success(m);
    void qc.invalidateQueries({ queryKey: ['qa'] });
  };
  const create = useMutation({
    mutationFn: (b: unknown) => api<QaProject>('/qa/projects', { method: 'POST', body: b }),
    onSuccess: (p) => {
      setCreating(false);
      setSel(p.id);
      done(`${p.code} created`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const status = useMutation({
    mutationFn: (v: { id: string; status: string }) => api(`/qa/projects/${v.id}/status`, { method: 'PATCH', body: { status: v.status } }),
    onSuccess: () => done('Status saved'),
    onError: (e) => toast.error(errMsg(e)),
  });
  const urls = useMutation({
    mutationFn: (v: { id: string; gateUrl: string | null; clientUrl: string }) => api(`/qa/projects/${v.id}/urls`, { method: 'PATCH', body: { gateUrl: v.gateUrl, clientUrl: v.clientUrl } }),
    onSuccess: () => {
      setVersioning(null);
      done('Survey links saved. The next job runs against them; compare jobs under Quality Control.');
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const addScenario = useMutation({
    mutationFn: (b: unknown) => api('/qa/scenarios', { method: 'POST', body: b }),
    onSuccess: () => {
      setAdding(false);
      done('Scenario saved');
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const archive = useMutation({
    mutationFn: (id: string) => api(`/qa/scenarios/${id}`, { method: 'DELETE' }),
    onSuccess: () => done('Scenario archived'),
    onError: (e) => toast.error(errMsg(e)),
  });

  if (!canRead) return <NoPermission permission="qa_projects.read" />;
  const usable = (auths.data ?? []).filter((a) => a.state === 'approved');

  const onCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    create.mutate({
      code: s('code'),
      name: s('name'),
      samptrekProjectRef: s('ref') || undefined,
      authorizationId: s('auth'),
      environment: s('env'),
      gateUrl: s('gate') || undefined,
      clientUrl: s('client'),
      expectedLoiMinutes: s('loi') ? Number(s('loi')) : undefined,
      expectedIrPercent: s('ir') ? Number(s('ir')) : undefined,
    });
  };
  const onScenario = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    let overrides: Record<string, unknown> = {};
    try {
      overrides = s('overrides') ? JSON.parse(s('overrides')) : {};
    } catch {
      toast.error('Fixed answers must be JSON, for example {"G2": 150}');
      return;
    }
    addScenario.mutate({
      projectId: current!.id,
      name: s('name'),
      profileId: s('profile'),
      objective: s('objective'),
      language: s('language'),
      timing: s('timing'),
      answerStrategy: s('strategy'),
      assertions: {
        ...(s('expect') ? { expectOutcome: s('expect') } : {}),
        ...(s('maxLoi') ? { maxLoiSeconds: Number(s('maxLoi')) } : {}),
        ...(s('required') ? { requiredQuestions: s('required').split(/[\s,]+/).filter(Boolean) } : {}),
      },
      overrides,
    });
  };

  return (
    <>
      <PageHeader
        title="QA projects and scenarios"
        description="Each QA project points at approved test survey links inside one authorization. Scenarios are deterministic test cases: a fictional profile, an expected path, a language and a timing case."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus /> New QA project
            </Button>
          )
        }
      />
      <SyntheticBanner />
      <Card>
        <CardHeader title="QA projects" />
        {projects.isLoading ? (
          <Loading />
        ) : projects.error ? (
          <ErrorState error={projects.error} />
        ) : !projects.data?.length ? (
          <Empty title="No QA projects yet">Approve an authorization in the Authorization Centre, then create a project on it.</Empty>
        ) : (
          <Table head={['Project', 'SampTrek ref', 'Environment', 'Survey links', 'Authorization', 'Scenarios', 'Sessions', 'Status', '']}>
            {projects.data.map((p) => (
              <tr key={p.id} className={p.id === current?.id ? 'bg-accent/5' : undefined}>
                <Td>
                  <button type="button" className="text-left hover:underline" onClick={() => setSel(p.id)}>
                    <span className="font-mono text-xs">{p.code}</span>
                    <span className="block font-medium">{p.name}</span>
                  </button>
                </Td>
                <Td className="font-mono text-xs">{p.samptrekProjectRef ?? '—'}</Td>
                <Td className="text-xs">{ENVIRONMENT_LABELS[p.environment as QaEnvironment] ?? p.environment}</Td>
                <Td className="max-w-72 font-mono text-[11px] break-all text-muted">
                  {p.gateUrl && <p>Gate: {p.gateUrl.replace(/^https:\/\/[^/]+/, '')}</p>}
                  <p>Client: {p.clientUrl.replace(/^https:\/\/[^/]+/, '')}</p>
                </Td>
                <Td className="text-xs">
                  <StateBadge s={p.authorization.state} />
                  <p className="mt-1 text-muted">{p.authorization.surveyOwner}</p>
                </Td>
                <Td className="tabular-nums">{p.scenarios}</Td>
                <Td className="tabular-nums">{p.sessions}</Td>
                <Td>
                  <StateBadge s={p.status} />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {canManage && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setVersioning(p)}>
                        Change links
                      </Button>
                      {p.status === 'active' ? (
                        <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: p.id, status: 'paused' })}>
                          <Pause /> Pause
                        </Button>
                      ) : p.status === 'paused' ? (
                        <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: p.id, status: 'active' })}>
                          <Play /> Resume
                        </Button>
                      ) : null}
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {current && (
        <Card className="mt-6">
          <CardHeader
            title={`Scenarios for ${current.code}`}
            description="Objectives are expectations to check, never dispositions the runner aims for"
            action={
              canScenarios && (
                <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
                  <Plus /> Add scenario
                </Button>
              )
            }
          />
          {scenarios.isLoading ? (
            <Loading />
          ) : !scenarios.data?.length ? (
            <Empty title="No scenarios yet" />
          ) : (
            <Table head={['Scenario', 'Fictional profile', 'Objective', 'Language', 'Timing', 'Answers', 'Assertions and fixed answers', '']}>
              {scenarios.data.map((s) => (
                <tr key={s.id} data-testid="scenario-row">
                  <Td className="font-medium">{s.name}</Td>
                  <Td className="text-xs">
                    <span className="font-mono">{s.profileCode}</span>
                    <span className="block text-muted">{s.profileLabel.replace(/^Fictional profile [^:]+: /, '')}</span>
                  </Td>
                  <Td className="text-xs">{OBJECTIVE_LABELS[s.objective]}</Td>
                  <Td className="text-xs">{LANGUAGE_LABELS[s.language]}</Td>
                  <Td className="text-xs">{TIMING_LABELS[s.timing].split(':')[0]}</Td>
                  <Td>
                    <Badge tone={s.answerStrategy === 'model' ? 'accent' : 'neutral'}>{s.answerStrategy === 'model' ? 'Model gateway' : 'Rules'}</Badge>
                  </Td>
                  <Td className="font-mono text-[11px] text-muted">
                    {Object.keys(s.assertions).length ? JSON.stringify(s.assertions) : '—'}
                    {Object.keys(s.overrides).length ? <p>fixed {JSON.stringify(s.overrides)}</p> : null}
                  </Td>
                  <Td className="text-right">
                    {canScenarios && (
                      <Button size="sm" variant="ghost" aria-label={`Archive ${s.name}`} onClick={() => archive.mutate(s.id)}>
                        <Archive />
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <Dialog open={creating} onOpenChange={setCreating} title="New QA project" description="Links are checked against the authorization's hosts now, and again by the worker before every session." wide>
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" htmlFor="p-code">
            <Input id="p-code" name="code" required defaultValue="QA-GROCERY" className="font-mono" />
          </Field>
          <Field label="Name" htmlFor="p-name">
            <Input id="p-name" name="name" required defaultValue="DEMO Grocery tracker QA" />
          </Field>
          <Field label="Authorization" htmlFor="p-auth" hint={usable.length ? undefined : 'No approved authorization yet'}>
            <Select id="p-auth" name="auth" required>
              {usable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.surveyOwner} · {a.evidenceRef}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Environment" htmlFor="p-env">
            <Select id="p-env" name="env" defaultValue="sandbox">
              {QaEnvironment.options.map((e) => (
                <option key={e} value={e}>
                  {ENVIRONMENT_LABELS[e]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Gate survey link" htmlFor="p-gate">
            <Select id="p-gate" name="gate" defaultValue={fixtures.gate[0]?.url}>
              <option value="">No gate survey</option>
              {fixtures.gate.map((f) => (
                <option key={f.url} value={f.url}>
                  {f.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Client survey link" htmlFor="p-client">
            <Select id="p-client" name="client" required>
              {fixtures.client.map((f) => (
                <option key={f.url} value={f.url}>
                  {f.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="SampTrek project ref (optional)" htmlFor="p-ref" hint="Links the synthetic summary shown in Supply360">
            <Input id="p-ref" name="ref" defaultValue="PRX10001" className="font-mono" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expected LOI (min)" htmlFor="p-loi">
              <Input id="p-loi" name="loi" type="number" min={1} max={120} defaultValue={12} />
            </Field>
            <Field label="Expected IR (%)" htmlFor="p-ir">
              <Input id="p-ir" name="ir" type="number" min={1} max={100} defaultValue={40} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending || !usable.length}>
              Create
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!versioning} onOpenChange={(o) => !o && setVersioning(null)} title="Change survey links" description="For example when the client publishes a new version. Earlier jobs keep their results for regression comparison.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            urls.mutate({ id: versioning!.id, gateUrl: String(f.get('gate') ?? '') || null, clientUrl: String(f.get('client')) });
          }}
          className="space-y-4"
        >
          <Field label="Gate survey link" htmlFor="v-gate">
            <Select id="v-gate" name="gate" defaultValue={versioning?.gateUrl ?? ''}>
              <option value="">No gate survey</option>
              {fixtures.gate.map((f) => (
                <option key={f.url} value={f.url}>
                  {f.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Client survey link" htmlFor="v-client">
            <Select id="v-client" name="client" defaultValue={versioning?.clientUrl}>
              {fixtures.client.map((f) => (
                <option key={f.url} value={f.url}>
                  {f.title}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={urls.isPending}>
              Save links
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={adding} onOpenChange={setAdding} title="Add scenario" description="A deterministic test case: the same scenario gives the same answers every run." wide>
        <form onSubmit={onScenario} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="s-name">
            <Input id="s-name" name="name" required minLength={3} defaultValue="Qualifier completes" />
          </Field>
          <Field label="Fictional profile" htmlFor="s-profile">
            <Select id="s-profile" name="profile" required>
              {(profiles.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Objective" htmlFor="s-objective">
            <Select id="s-objective" name="objective" defaultValue="complete_path">
              {OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {OBJECTIVE_LABELS[o]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Language" htmlFor="s-language">
            <Select id="s-language" name="language" defaultValue="en">
              {QA_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABELS[l]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Timing case" htmlFor="s-timing">
            <Select id="s-timing" name="timing" defaultValue="nominal">
              {TIMINGS.map((t) => (
                <option key={t} value={t}>
                  {TIMING_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Open answers" htmlFor="s-strategy" hint="Model answers go through the gateway and its budgets">
            <Select id="s-strategy" name="strategy" defaultValue="rules">
              <option value="rules">Rules from the profile</option>
              <option value="model">Model gateway</option>
            </Select>
          </Field>
          <Field label="Expected outcome (optional)" htmlFor="s-expect" hint="Overrides the objective">
            <Select id="s-expect" name="expect" defaultValue="">
              <option value="">From the objective</option>
              {SYNTHETIC_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {SYNTHETIC_OUTCOME_LABELS[o]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Max LOI, seconds (optional)" htmlFor="s-maxloi">
            <Input id="s-maxloi" name="maxLoi" type="number" min={10} max={7200} />
          </Field>
          <Field label="Questions that must be shown" htmlFor="s-required" hint="Question ids, comma separated">
            <Input id="s-required" name="required" placeholder="C5, C6" className="font-mono" />
          </Field>
          <Field label="Fixed answers (JSON)" htmlFor="s-overrides" hint='Deliberate inputs, such as {"G2": 150} to test range checks'>
            <Input id="s-overrides" name="overrides" placeholder='{"G2": 150}' className="font-mono" />
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={addScenario.isPending}>
              Save scenario
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
