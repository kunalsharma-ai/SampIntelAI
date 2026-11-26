'use client';
import { SYNTHETIC_OUTCOME_LABELS, SYNTHETIC_OUTCOMES } from '@si/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { SessionRow } from '@/components/qa/data';
import { OutcomeBadge, ProjectPicker, SyntheticBanner, Table, Td, secs, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Empty, Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';

export default function ResponseAuditPage() {
  const can = useCan('results.read');
  const [pid, setPid] = useState('');
  const [outcome, setOutcome] = useState('');
  const q = new URLSearchParams({ ...(pid ? { projectId: pid } : {}), ...(outcome ? { outcome } : {}) }).toString();
  const rows = useQuery({ queryKey: ['qa', 'sessions', q], queryFn: () => api<SessionRow[]>(`/qa/sessions${q ? `?${q}` : ''}`), enabled: can });
  if (!can) return <NoPermission permission="results.read" />;
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 13 of 19</Badge>}
        title="Response Audit"
        description="Actual outcomes of every synthetic session, with its question-level records and assertion results. Open a session to see each question, answer and check."
        actions={
          <>
            <Select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="w-auto">
              <option value="">All outcomes</option>
              {SYNTHETIC_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {SYNTHETIC_OUTCOME_LABELS[o]}
                </option>
              ))}
            </Select>
            <ProjectPicker value={pid} onChange={setPid} />
          </>
        }
      />
      <SyntheticBanner />
      <Card>
        <CardHeader title="Synthetic sessions" description="Newest first, up to 500" />
        {rows.isLoading ? (
          <Loading />
        ) : !rows.data?.length ? (
          <Empty title="No sessions match" />
        ) : (
          <Table head={['Session', 'Project', 'Scenario', 'Profile', 'Actual outcome', 'Stage reached', 'LOI', 'Assertions', 'Quality', 'Review', 'When']}>
            {rows.data.map((s) => (
              <tr key={s.id} data-testid="session-row">
                <Td>
                  <Link href={`/response-audit/${s.id}`} className="font-mono text-xs text-accent hover:underline">
                    #{s.seq} {s.id.slice(0, 8)}
                  </Link>
                </Td>
                <Td className="font-mono text-xs">{s.projectCode}</Td>
                <Td className="text-xs">{s.scenarioName}</Td>
                <Td className="font-mono text-xs">{s.profileCode}</Td>
                <Td>
                  <OutcomeBadge o={s.outcome} />
                </Td>
                <Td className="text-xs">{s.lastStage}</Td>
                <Td className="text-xs tabular-nums">{secs(s.loiSeconds)}</Td>
                <Td className="text-xs tabular-nums">
                  <span className="text-success">{s.assertionsPassed} passed</span>
                  {s.assertionsFailed ? <span className="block text-danger">{s.assertionsFailed} failed</span> : null}
                </Td>
                <Td className="tabular-nums">{s.qualityScore}</Td>
                <Td className="text-xs">{s.reviewStatus.replaceAll('_', ' ')}</Td>
                <Td className="text-xs whitespace-nowrap">{when(s.startedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
