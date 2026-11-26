'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ProjectPicker, SyntheticBanner, Table, Td, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Empty, Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';

interface IpRow {
  id: string;
  projectCode: string;
  sessionSeq: number;
  ip: string;
  source: string;
  geo: string | null;
  isp: string | null;
  riskScore: number | null;
  riskProvider: string | null;
  duplicateCount: number;
  at: string;
}

export default function IpPage() {
  const can = useCan('ip_risk.read');
  const [pid, setPid] = useState('');
  const rows = useQuery({ queryKey: ['qa', 'ip', pid], queryFn: () => api<IpRow[]>(`/qa/ip-records${pid ? `?projectId=${pid}` : ''}`), enabled: can });
  if (!can) return <NoPermission permission="ip_risk.read" />;
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 11 of 19</Badge>}
        title="IP Intelligence"
        description="The runner's actual, permitted network metadata for each session, as it is. SampIntel never rotates addresses, disguises its origin or works on reputation. Access is limited to roles with ip_risk.read."
        actions={<ProjectPicker value={pid} onChange={setPid} />}
      />
      <SyntheticBanner>The FIXTURE driver opens no network connection, so it records the documentation address 192.0.2.10 and no risk score. No risk-signal provider is configured.</SyntheticBanner>
      <Card>
        <CardHeader title="Network observations" />
        {rows.isLoading ? (
          <Loading />
        ) : !rows.data?.length ? (
          <Empty title="No sessions yet" />
        ) : (
          <Table head={['Project', 'Session', 'Address', 'Source', 'Approx. location', 'ISP', 'Risk score', 'Seen before in project', 'When']}>
            {rows.data.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono text-xs">{r.projectCode}</Td>
                <Td className="tabular-nums">#{r.sessionSeq}</Td>
                <Td className="font-mono text-xs">{r.ip}</Td>
                <Td className="text-xs">{r.source.replaceAll('_', ' ')}</Td>
                <Td className="text-xs">{r.geo ?? '—'}</Td>
                <Td className="text-xs">{r.isp ?? '—'}</Td>
                <Td className="text-xs">{r.riskScore ?? 'No provider'}</Td>
                <Td className="tabular-nums">{r.duplicateCount}</Td>
                <Td className="text-xs whitespace-nowrap">{when(r.at)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
