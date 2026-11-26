'use client';
import { TIMING_LABELS, TIMINGS } from '@si/contracts';
import { useJobs } from '@/components/qa/data';
import { StateBadge, SyntheticBanner, Table, Td } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Empty, NoPermission } from '@/components/ui/states';

const DETAIL: Record<(typeof TIMINGS)[number], string> = {
  nominal: 'Fixed reading time per input type (4 to 25 s) plus 1 s page latency.',
  slow_pages: 'Adds 20 s latency to every page, to check that slow pages do not break the path or its LOI assertions.',
  timeout: 'Holds the third page 15 s past the 60 s page limit. The session ends as a timeout and the page is recorded unanswered.',
};

export default function IntervalsPage() {
  const can = useCan('qa_projects.read');
  const jobs = useJobs();
  if (!can) return <NoPermission permission="qa_projects.read" />;
  const paced = (jobs.data ?? []).filter((j) => j.intervalSeconds > 0);
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 8 of 19</Badge>}
        title="Interval Controller"
        description="Bounded, deterministic QA timing for timeout and latency tests. There is no random jitter and no imitation of human pacing: timing exists to test the survey, not to look like a person."
      />
      <SyntheticBanner />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Timing cases" description="Chosen per scenario" />
          <ul className="divide-y divide-border">
            {TIMINGS.map((t) => (
              <li key={t} className="px-5 py-3">
                <p className="text-sm font-medium">{TIMING_LABELS[t]}</p>
                <p className="text-xs text-muted">{DETAIL[t]}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Jobs with a fixed interval" description="Seconds between two sessions, set on the job" />
          {!paced.length ? (
            <Empty title="No paced jobs">Jobs with no interval run up to ten sessions per worker pass.</Empty>
          ) : (
            <Table head={['Project', 'State', 'Interval', 'Progress']}>
              {paced.map((j) => (
                <tr key={j.id}>
                  <Td className="font-mono text-xs">{j.projectCode}</Td>
                  <Td>
                    <StateBadge s={j.status} />
                  </Td>
                  <Td className="tabular-nums">{j.intervalSeconds} s</Td>
                  <Td className="text-xs tabular-nums">
                    {j.doneSessions} / {j.totalSessions}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
