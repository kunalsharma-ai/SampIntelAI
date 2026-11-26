'use client';
import { useState } from 'react';
import { useStats } from '@/components/qa/data';
import { Bars, ProjectPicker, Stat, SyntheticBanner, secs } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Empty, Loading, NoPermission } from '@/components/ui/states';

export default function LoiPage() {
  const can = useCan('results.read');
  const [pid, setPid] = useState('');
  const stats = useStats(pid || undefined);
  if (!can) return <NoPermission permission="results.read" />;
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 10 of 19</Badge>}
        title="LOI Monitoring"
        description="Length of completed synthetic sessions. The FIXTURE driver runs on a sandbox clock: per-page reading time plus the scenario's latency case, recorded as such and never presented as human LOI."
        actions={<ProjectPicker value={pid} onChange={setPid} />}
      />
      <SyntheticBanner />
      {stats.isLoading ? (
        <Loading />
      ) : !stats.data?.length ? (
        <Empty title="No QA projects yet" />
      ) : (
        <div className="space-y-6">
          {stats.data.map((s) => (
            <Card key={s.projectId}>
              <CardHeader title={`${s.code} · ${s.name}`} description={`${s.loi.n} completes · ${s.loi.clock} clock`} />
              <CardBody className="grid gap-4 lg:grid-cols-3">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Median" value={secs(s.loi.median)} />
                  <Stat label="Expected" value={s.expectedLoiMinutes ? `${s.expectedLoiMinutes} min` : '—'} />
                  <Stat label="25th percentile" value={secs(s.loi.p25)} />
                  <Stat label="75th percentile" value={secs(s.loi.p75)} />
                </div>
                <div className="lg:col-span-2">
                  <p className="mb-2 text-xs font-medium text-muted">Completes by length, {s.loi.bucketSeconds} s buckets</p>
                  {s.loi.histogram.length ? (
                    <Bars rows={s.loi.histogram.map((h) => ({ label: `${secs(h.from)}+`, n: h.n }))} />
                  ) : (
                    <p className="text-sm text-muted">No completes yet.</p>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
