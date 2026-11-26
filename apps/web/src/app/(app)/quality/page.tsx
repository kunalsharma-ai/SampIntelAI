'use client';
import { FINDING_LABELS } from '@si/contracts';
import { useQuery } from '@tanstack/react-query';
import { GitCompare } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useJobs } from '@/components/qa/data';
import { Bars, OutcomeBadge, ProjectPicker, SyntheticBanner, Table, Td, secs, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Empty, ErrorState, Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

interface Quality {
  byKind: Record<string, number>;
  sessions: { id: string; seq: number; code: string; score: number; findings: { kind: string; severity: string; detail: string }[]; review: string; outcome: string; startedAt: string }[];
}
interface Side {
  sessions: number;
  outcomes: Record<string, number>;
  main: string;
  avgLoi: number;
  failedAssertions: number;
  avgQuality: number;
  questions: string[];
}
interface Regression {
  a: { id: string; urls: { gate: string | null; client: string }[] };
  b: { id: string; urls: { gate: string | null; client: string }[] };
  changed: number;
  rows: { scenarioId: string; scenario: string; a: Side | null; b: Side | null; outcomeChanged: boolean; questionsAdded: string[]; questionsRemoved: string[] }[];
}
const path = (u?: string | null) => (u ? u.replace(/^https:\/\/[^/]+/, '') : '—');

function Regress() {
  const [pid, setPid] = useState('');
  const jobs = useJobs(pid || undefined);
  const list = (jobs.data ?? []).filter((j) => j.doneSessions > 0);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const ja = a || list[1]?.id || '';
  const jb = b || list[0]?.id || '';
  const r = useQuery({ queryKey: ['qa', 'regression', ja, jb], queryFn: () => api<Regression>(`/qa/regression?a=${ja}&b=${jb}`), enabled: !!ja && !!jb && ja !== jb });
  const label = (id: string) => {
    const j = list.find((x) => x.id === id);
    return j ? `${j.projectCode} · ${when(j.createdAt)} · ${j.doneSessions} sessions` : id;
  };
  return (
    <Card className="mt-6">
      <CardHeader title="Regression comparison" description="Two jobs of one QA project, scenario by scenario: actual outcome, questions met, assertions and LOI" action={<ProjectPicker value={pid} onChange={(v) => { setPid(v); setA(''); setB(''); }} />} />
      <CardBody className="flex flex-wrap items-center gap-3">
        <GitCompare className="size-4 text-accent" />
        <Select aria-label="Baseline job" value={ja} onChange={(e) => setA(e.target.value)} className="w-auto">
          {list.map((j) => (
            <option key={j.id} value={j.id}>
              Baseline: {label(j.id)}
            </option>
          ))}
        </Select>
        <Select aria-label="Compared job" value={jb} onChange={(e) => setB(e.target.value)} className="w-auto">
          {list.map((j) => (
            <option key={j.id} value={j.id}>
              Compared: {label(j.id)}
            </option>
          ))}
        </Select>
      </CardBody>
      {list.length < 2 ? (
        <Empty title="Run at least two jobs to compare" />
      ) : r.error ? (
        <ErrorState error={r.error} />
      ) : !r.data ? (
        <Loading />
      ) : (
        <>
          <p className="px-5 pb-3 text-xs text-muted">
            Baseline client link {path(r.data.a.urls[0]?.client)} · compared {path(r.data.b.urls[0]?.client)} ·{' '}
            <strong className={r.data.changed ? 'text-warning' : 'text-success'}>{r.data.changed} scenario{r.data.changed === 1 ? '' : 's'} changed</strong>
          </p>
          <Table head={['Scenario', 'Baseline outcome', 'Compared outcome', 'Questions added', 'Questions removed', 'Failed assertions', 'Avg LOI']}>
            {r.data.rows.map((x) => (
              <tr key={x.scenarioId} className={cn((x.outcomeChanged || x.questionsAdded.length || x.questionsRemoved.length) && 'bg-warning/5')} data-testid="regression-row">
                <Td className="font-medium">{x.scenario}</Td>
                <Td>{x.a ? <OutcomeBadge o={x.a.main} /> : '—'}</Td>
                <Td>
                  {x.b ? <OutcomeBadge o={x.b.main} /> : '—'}
                  {x.outcomeChanged && <span className="ml-1 text-xs text-warning">changed</span>}
                </Td>
                <Td className="font-mono text-xs text-success">{x.questionsAdded.join(' ') || '—'}</Td>
                <Td className="font-mono text-xs text-danger">{x.questionsRemoved.join(' ') || '—'}</Td>
                <Td className="text-xs tabular-nums">
                  {x.a?.failedAssertions ?? '—'} → {x.b?.failedAssertions ?? '—'}
                </Td>
                <Td className="text-xs tabular-nums">
                  {secs(x.a?.avgLoi)} → {secs(x.b?.avgLoi)}
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Card>
  );
}

export default function QualityPage() {
  const can = useCan('results.read');
  const [pid, setPid] = useState('');
  const q = useQuery({ queryKey: ['qa', 'quality', pid], queryFn: () => api<Quality>(`/qa/quality${pid ? `?projectId=${pid}` : ''}`), enabled: can });
  if (!can) return <NoPermission permission="results.read" />;
  const flagged = (q.data?.sessions ?? []).filter((s) => s.findings.some((f) => f.severity !== 'info'));
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 14 of 19</Badge>}
        title="Quality Control"
        description="Logic, validation, localization and consistency findings from synthetic sessions, and regressions between survey versions. Findings are contextual and reviewed by a person; none rejects anything automatically."
        actions={<ProjectPicker value={pid} onChange={setPid} />}
      />
      <SyntheticBanner />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Findings by kind" />
          <CardBody>
            {q.isLoading ? (
              <Loading />
            ) : Object.keys(q.data?.byKind ?? {}).length ? (
              <Bars rows={Object.entries(q.data!.byKind).sort((x, y) => y[1] - x[1]).map(([k, n]) => ({ label: FINDING_LABELS[k] ?? k, n }))} />
            ) : (
              <p className="text-sm text-muted">No findings yet.</p>
            )}
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Sessions with findings to review" description="Open one to review it" />
          {!flagged.length ? (
            <Empty title="Nothing to review" />
          ) : (
            <Table head={['Session', 'Outcome', 'Score', 'Findings', 'Review']}>
              {flagged.slice(0, 50).map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link href={`/response-audit/${s.id}`} className="font-mono text-xs text-accent hover:underline">
                      {s.code} #{s.seq}
                    </Link>
                  </Td>
                  <Td>
                    <OutcomeBadge o={s.outcome} />
                  </Td>
                  <Td className="tabular-nums">{s.score}</Td>
                  <Td className="text-xs">
                    {s.findings
                      .filter((f) => f.severity !== 'info')
                      .map((f) => FINDING_LABELS[f.kind] ?? f.kind)
                      .join('; ')}
                  </Td>
                  <Td className="text-xs">{s.review.replaceAll('_', ' ')}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Regress />
    </>
  );
}
