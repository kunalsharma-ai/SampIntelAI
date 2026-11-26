'use client';
import { FINDING_LABELS } from '@si/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import type { SessionRow } from '@/components/qa/data';
import { Field, OutcomeBadge, Stat, SyntheticBanner, Table, Td, errMsg, secs, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ErrorState, Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';

interface Detail extends Omit<SessionRow, 'scenarioName' | 'profileCode' | 'projectCode'> {
  surveyUrls: { gate: string | null; client: string };
  redirectUrl: string | null;
  scenario: { name: string; objective: string; timing: string; answerStrategy: string };
  profile: { code: string; label: string };
  questions: { id: string; seq: number; stage: string; questionId: string; questionText: string; inputKind: string; detectedType: string; topic: string | null; language: string; answer: unknown; answeredBy: string; validation: string; flags: string[]; seconds: number }[];
  validations: { id: string; assertion: string; passed: boolean; expected: string | null; actual: string | null }[];
  redirects: { id: string; url: string; host: string; allowed: boolean; outcome: string | null }[];
  ip: { ip: string; source: string; duplicateCount: number }[];
  quality: { score: number; findings: { kind: string; severity: string; questionId?: string; detail: string }[] } | null;
  security: { id: string; kind: string; severity: string; at: string }[];
}

const show = (a: unknown) => (a == null ? '—' : typeof a === 'string' ? a : JSON.stringify(a));

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan('results.read');
  const canReview = useCan('results.review');
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ['qa', 'session', id], queryFn: () => api<Detail>(`/qa/sessions/${id}`), enabled: can });
  const review = useMutation({
    mutationFn: (b: unknown) => api(`/qa/sessions/${id}/review`, { method: 'POST', body: b }),
    onSuccess: () => {
      toast.success('Review saved');
      void qc.invalidateQueries({ queryKey: ['qa'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!can) return <NoPermission permission="results.read" />;
  if (d.isLoading) return <Loading />;
  if (d.error || !d.data) return <ErrorState error={d.error} />;
  const s = d.data;
  return (
    <>
      <Link href="/response-audit" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-text">
        <ArrowLeft className="size-3.5" /> Response Audit
      </Link>
      <PageHeader
        eyebrow={<Badge tone="demo">Synthetic session #{s.seq}</Badge>}
        title={s.scenario.name}
        description={`${s.profile.label}. ${s.environment} environment, ${s.language}, ${s.scenario.timing} timing, ${s.scenario.answerStrategy} answers.`}
      />
      <SyntheticBanner />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Actual outcome" value={<OutcomeBadge o={s.outcome} />} hint={s.stopReason ? s.stopReason.replaceAll('_', ' ') : `Ended at ${s.lastStage} stage`} />
        <Stat label="LOI" value={secs(s.loiSeconds)} hint={`${s.clock} clock`} />
        <Stat label="Questions met" value={s.questionCount} />
        <Stat label="Assertions" value={`${s.assertionsPassed}/${s.assertionsPassed + s.assertionsFailed}`} tone={s.assertionsFailed ? 'danger' : 'success'} hint={s.assertionsFailed ? `${s.assertionsFailed} failed` : 'All passed'} />
        <Stat label="Quality score" value={s.quality?.score ?? '—'} hint="Contextual, never a rejection" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Assertions" />
          <ul className="divide-y divide-border">
            {s.validations.map((v) => (
              <li key={v.id} className="flex items-start gap-3 px-5 py-2.5 text-sm" data-testid="assertion">
                {v.passed ? <CheckCircle2 className="mt-0.5 size-4 text-success" aria-label="Passed" /> : <XCircle className="mt-0.5 size-4 text-danger" aria-label="Failed" />}
                <span className="font-mono text-xs">{v.assertion}</span>
                <span className="ml-auto text-xs text-muted">
                  expected {v.expected ?? '—'} · actual {v.actual ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Quality findings" />
          {s.quality?.findings.length ? (
            <ul className="divide-y divide-border">
              {s.quality.findings.map((f, i) => (
                <li key={i} className="px-5 py-2.5 text-xs">
                  <Badge tone={f.severity === 'high' ? 'danger' : f.severity === 'medium' ? 'warning' : 'neutral'}>{f.severity}</Badge>{' '}
                  {FINDING_LABELS[f.kind] ?? f.kind}
                  <p className="mt-0.5 text-muted">
                    {f.questionId ? `${f.questionId}: ` : ''}
                    {f.detail}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-5 text-sm text-muted">No findings.</p>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Question records" description="What each page showed and what the fictional profile answered" />
        <Table head={['#', 'Stage', 'Question', 'Recognized', 'Language', 'Answer', 'By', 'Survey validation', 'Flags', 'Time']}>
          {s.questions.map((q) => (
            <tr key={q.id} data-testid="question-row">
              <Td className="tabular-nums">{q.seq}</Td>
              <Td className="text-xs">{q.stage}</Td>
              <Td className="max-w-80">
                <span className="font-mono text-xs">{q.questionId}</span>
                <p className="text-xs text-muted">{q.questionText}</p>
              </Td>
              <Td className="font-mono text-xs">
                {q.detectedType}
                {q.topic ? ` · ${q.topic}` : ''}
              </Td>
              <Td className="font-mono text-xs">{q.language}</Td>
              <Td className="max-w-64 text-xs break-words">{show(q.answer)}</Td>
              <Td className="text-xs">{q.answeredBy}</Td>
              <Td className={q.validation === 'accepted' ? 'text-xs text-success' : 'text-xs text-warning'}>{q.validation}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {q.flags.map((f) => (
                    <Badge key={f} tone="warning">
                      {f.replaceAll('_', ' ')}
                    </Badge>
                  ))}
                </div>
              </Td>
              <Td className="text-xs tabular-nums">{q.seconds} s</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Redirect" />
          <div className="space-y-1 p-5 text-xs">
            {s.redirects.length ? (
              s.redirects.map((r) => (
                <div key={r.id}>
                  <p className="font-mono break-all">{r.url}</p>
                  <p className={r.allowed ? 'text-success' : 'text-danger'}>{r.allowed ? `Allowed host, status ${r.outcome}` : `Blocked: ${r.host} is not in the authorization`}</p>
                </div>
              ))
            ) : (
              <p className="text-muted">No redirect reached.</p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Network and security" />
          <div className="space-y-1 p-5 text-xs">
            {s.ip.map((r, i) => (
              <p key={i}>
                <span className="font-mono">{r.ip}</span> · {r.source.replaceAll('_', ' ')} · seen {r.duplicateCount} times before
              </p>
            ))}
            {s.security.map((e) => (
              <p key={e.id} className="text-danger">
                {e.kind.replaceAll('_', ' ')} ({e.severity})
              </p>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Human review" description={s.reviewedBy ? `${s.reviewStatus.replaceAll('_', ' ')} by ${s.reviewedBy}, ${when(s.reviewedAt)}` : 'Not reviewed yet'} />
          {canReview ? (
            <form
              className="space-y-3 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                review.mutate({ status: f.get('status'), note: f.get('note') });
              }}
            >
              <Field label="Verdict" htmlFor="rv-status">
                <Select id="rv-status" name="status" defaultValue="reviewed_ok">
                  <option value="reviewed_ok">Behaves as intended</option>
                  <option value="reviewed_issue">Survey issue found</option>
                </Select>
              </Field>
              <Field label="Note" htmlFor="rv-note">
                <Input id="rv-note" name="note" required minLength={3} defaultValue={s.reviewNote ?? ''} />
              </Field>
              <Button type="submit" variant="primary" size="sm" disabled={review.isPending}>
                Save review
              </Button>
            </form>
          ) : (
            <p className="p-5 text-sm text-muted">{s.reviewNote ?? 'Needs results.review to review.'}</p>
          )}
        </Card>
      </div>
    </>
  );
}
