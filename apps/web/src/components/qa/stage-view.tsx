'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ProjectPicker, StateBadge, SyntheticBanner, Table, Td, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Empty, Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';

interface Surveys {
  projects: { id: string; code: string; name: string; url: string; status: string }[];
  versions: { id: string; projectId: string; url: string; fingerprint: string; questionIds: string[]; firstSeenAt: string; lastSeenAt: string }[];
  fixtures: { url: string; title: string; questions: { id: string; input: string; text: string; languages: string[] }[] }[];
}
export interface QuestionAudit {
  stage: string;
  questionId: string;
  text: string;
  inputKind: string;
  detectedType: string;
  shown: number;
  rejected: number;
  timedOut: number;
  byModel: number;
  byOverride: number;
  languages: string[];
  flags: string[];
}

export function QuestionAuditTable({ rows }: { rows: QuestionAudit[] }) {
  return (
    <Table head={['Question', 'Input → recognized', 'Shown', 'Rejected', 'Timed out', 'Answered by', 'Languages', 'Flags']}>
      {rows.map((q) => (
        <tr key={`${q.stage}:${q.questionId}`}>
          <Td className="max-w-96">
            <span className="font-mono text-xs">{q.questionId}</span>
            <p className="text-xs text-muted">{q.text}</p>
          </Td>
          <Td className="font-mono text-xs whitespace-nowrap">
            {q.inputKind} → {q.detectedType}
          </Td>
          <Td className="tabular-nums">{q.shown}</Td>
          <Td className={q.rejected ? 'text-warning tabular-nums' : 'tabular-nums'}>{q.rejected}</Td>
          <Td className={q.timedOut ? 'text-danger tabular-nums' : 'tabular-nums'}>{q.timedOut}</Td>
          <Td className="text-xs">
            {q.byModel ? `${q.byModel} model, ` : ''}
            {q.byOverride ? `${q.byOverride} fixed, ` : ''}rest rules
          </Td>
          <Td className="font-mono text-xs">{q.languages.join(' ')}</Td>
          <Td>
            <div className="flex flex-wrap gap-1">
              {q.flags.map((f) => (
                <Badge key={f} tone={f === 'prompt_injection_suspected' ? 'danger' : 'warning'}>
                  {f.replaceAll('_', ' ')}
                </Badge>
              ))}
            </div>
          </Td>
        </tr>
      ))}
    </Table>
  );
}

export function StageView({ stage }: { stage: 'gate' | 'client' }) {
  const can = useCan('qa_projects.read');
  const canResults = useCan('results.read');
  const [pid, setPid] = useState('');
  const s = useQuery({ queryKey: ['qa', 'surveys', stage], queryFn: () => api<Surveys>(`/qa/surveys?stage=${stage}`) });
  const audit = useQuery({
    queryKey: ['qa', 'questions', stage, pid],
    queryFn: () => api<QuestionAudit[]>(`/qa/questions?stage=${stage}${pid ? `&projectId=${pid}` : ''}`),
    enabled: canResults,
  });
  if (!can) return <NoPermission permission="qa_projects.read" />;
  const title = stage === 'gate' ? 'Gate Survey Manager' : 'Client Survey Manager';
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module {stage === 'gate' ? 5 : 6} of 19</Badge>}
        title={title}
        description={
          stage === 'gate'
            ? 'QA of gate and screener logic: who passes, who terminates and why, on approved test links.'
            : 'QA of the client survey within a valid authorization: branching, validation, quotas, localization and redirects.'
        }
      />
      <SyntheticBanner />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={`QA projects with a ${stage} survey`} />
          {s.isLoading ? (
            <Loading />
          ) : !s.data?.projects.length ? (
            <Empty title="None yet" />
          ) : (
            <Table head={['Project', 'Link', 'Status']}>
              {s.data.projects.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <span className="font-mono text-xs">{p.code}</span>
                    <p className="text-xs text-muted">{p.name}</p>
                  </Td>
                  <Td className="font-mono text-[11px] break-all">{p.url}</Td>
                  <Td>
                    <StateBadge s={p.status} />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Versions the runner has seen" description="A new fingerprint means the question set changed" />
          {!s.data?.versions.length ? (
            <Empty title="No runs yet" />
          ) : (
            <Table head={['Link', 'Fingerprint', 'Questions met', 'Last seen']}>
              {s.data.versions.map((v) => (
                <tr key={v.id}>
                  <Td className="font-mono text-[11px] break-all">{v.url.replace(/^https:\/\/[^/]+/, '')}</Td>
                  <Td className="font-mono text-xs">{v.fingerprint}</Td>
                  <Td className="font-mono text-[11px]">{v.questionIds.join(' ')}</Td>
                  <Td className="text-xs whitespace-nowrap">{when(v.lastSeenAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Question audit" description="Every question the runner met at this stage" action={<ProjectPicker value={pid} onChange={setPid} />} />
        {!canResults ? (
          <p className="p-5 text-sm text-muted">Needs results.read.</p>
        ) : audit.isLoading ? (
          <Loading />
        ) : !audit.data?.length ? (
          <Empty title="No questions recorded yet" />
        ) : (
          <QuestionAuditTable rows={audit.data} />
        )}
      </Card>
      <Card className="mt-6">
        <CardHeader title="Sandbox test surveys" description="Served in-process by the FIXTURE driver; nothing leaves SampIntel" />
        <div className="divide-y divide-border">
          {s.data?.fixtures.map((f) => (
            <details key={f.url} className="px-5 py-3">
              <summary className="cursor-pointer text-sm font-medium">
                {f.title} <span className="font-mono text-[11px] text-muted">{f.url}</span>
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {f.questions.map((q) => (
                  <li key={q.id} className="flex gap-2">
                    <span className="w-8 font-mono">{q.id}</span>
                    <span className="w-16 font-mono text-muted">{q.input}</span>
                    <span className="flex-1">{q.text}</span>
                    <span className="font-mono text-muted">{q.languages.join(' ')}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </Card>
    </>
  );
}
