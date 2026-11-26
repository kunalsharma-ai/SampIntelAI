'use client';
import { JOB_STOP_LABELS } from '@si/contracts';
import { useQuery } from '@tanstack/react-query';
import { useJobs, windowText, type AuthView } from '@/components/qa/data';
import { StateBadge, SyntheticBanner, Table, Td, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Empty, Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';

export default function SchedulePage() {
  const can = useCan('qa_projects.read');
  const canAuth = useCan('authorizations.read');
  const jobs = useJobs();
  const auths = useQuery({ queryKey: ['authorizations'], queryFn: () => api<AuthView[]>('/authorizations'), enabled: canAuth });
  if (!can) return <NoPermission permission="qa_projects.read" />;
  const upcoming = (jobs.data ?? []).filter((j) => j.status === 'queued' || j.status === 'running');
  const approved = (auths.data ?? []).filter((a) => a.state === 'approved');
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 7 of 19</Badge>}
        title="Scheduling Engine"
        description="Jobs run only inside the approved execution windows of their authorization, in its timezone, and never after it expires. Outside a window a job waits; it is not skipped or squeezed in."
      />
      <SyntheticBanner />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming and running jobs" />
          {jobs.isLoading ? (
            <Loading />
          ) : !upcoming.length ? (
            <Empty title="Nothing scheduled" />
          ) : (
            <Table head={['Project', 'State', 'Next run', 'Progress', 'Waiting for']}>
              {upcoming.map((j) => (
                <tr key={j.id}>
                  <Td className="font-mono text-xs">{j.projectCode}</Td>
                  <Td>
                    <StateBadge s={j.status} />
                  </Td>
                  <Td className="text-xs whitespace-nowrap">{when(j.nextRunAt)}</Td>
                  <Td className="text-xs tabular-nums">
                    {j.doneSessions} / {j.totalSessions}
                  </Td>
                  <Td className="text-xs text-muted">{j.waitingFor ? (JOB_STOP_LABELS[j.waitingFor] ?? j.waitingFor.replaceAll('_', ' ')) : '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Approved execution windows" description="From each approved authorization" />
          {!canAuth ? (
            <p className="p-5 text-sm text-muted">Needs authorizations.read.</p>
          ) : !approved.length ? (
            <Empty title="No approved authorization" />
          ) : (
            <Table head={['Survey owner', 'Windows', 'Valid until', 'Sessions left']}>
              {approved.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium">{a.surveyOwner}</Td>
                  <Td className="text-xs">
                    {a.windows.map((w, i) => (
                      <p key={i}>{windowText(w)}</p>
                    ))}
                    <p className="text-muted">{a.timezone}</p>
                  </Td>
                  <Td className="text-xs whitespace-nowrap">{when(a.expiresAt)}</Td>
                  <Td className="tabular-nums">{a.maxSessions - a.sessionsUsed}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
