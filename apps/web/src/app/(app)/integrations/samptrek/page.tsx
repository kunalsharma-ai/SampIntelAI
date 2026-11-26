'use client';
import { Network } from 'lucide-react';
import { StateBadge, SyntheticBanner, Table, Td, useProjects } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Empty, Loading, NoPermission } from '@/components/ui/states';

export default function SamptrekPage() {
  const can = useCan('integrations.read');
  const projects = useProjects();
  if (!can) return <NoPermission permission="integrations.read" />;
  const linked = (projects.data ?? []).filter((p) => p.samptrekProjectRef);
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 2 of 19</Badge>}
        title="Samptrek Integration"
        description="QA projects carry the SampTrek project reference they test. SampIntel holds no SampTrek credentials and writes nothing to SampTrek."
      />
      <SyntheticBanner />
      <Card className="mb-6">
        <ul className="divide-y divide-border text-sm">
          <li className="flex gap-3 px-5 py-3">
            <Network className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>
              <strong className="font-medium">Results stay in SampIntel.</strong>{' '}
              <span className="text-muted">
                The spec allows syncing only to a dedicated synthetic QA namespace in the source. No such namespace is known in SampTrek's API, so synthetic results are kept here, separate, and never sent as respondent sessions.
              </span>
            </span>
          </li>
          <li className="flex gap-3 px-5 py-3">
            <Network className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>
              <strong className="font-medium">Supply360 reads a summary by reference.</strong>{' '}
              <span className="text-muted">With a scoped service token it can show these projects' synthetic outcomes beside its own, labelled and never added to human counts.</span>
            </span>
          </li>
        </ul>
      </Card>
      <Card>
        <CardHeader title="QA projects by SampTrek reference" />
        {projects.isLoading ? (
          <Loading />
        ) : !linked.length ? (
          <Empty title="No QA project names a SampTrek reference yet" />
        ) : (
          <Table head={['SampTrek ref', 'QA project', 'Environment', 'Sessions', 'Status', 'Sync']}>
            {linked.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono text-xs">{p.samptrekProjectRef}</Td>
                <Td>
                  <span className="font-mono text-xs">{p.code}</span>
                  <p className="text-xs text-muted">{p.name}</p>
                </Td>
                <Td className="text-xs">{p.environment}</Td>
                <Td className="tabular-nums">{p.sessions}</Td>
                <Td>
                  <StateBadge s={p.status} />
                </Td>
                <Td className="text-xs text-muted">Kept local</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
