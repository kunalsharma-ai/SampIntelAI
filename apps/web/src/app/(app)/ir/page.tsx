'use client';
import { SYNTHETIC_OUTCOME_LABELS, type SyntheticOutcome } from '@si/contracts';
import { useState } from 'react';
import { useStats } from '@/components/qa/data';
import { Bars, ProjectPicker, Stat, SyntheticBanner, pct } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Empty, Loading, NoPermission } from '@/components/ui/states';

export default function IrPage() {
  const can = useCan('results.read');
  const [pid, setPid] = useState('');
  const stats = useStats(pid || undefined);
  if (!can) return <NoPermission permission="results.read" />;
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 9 of 19</Badge>}
        title="IR Management"
        description="Synthetic path incidence: completes over completes and terminates among fictional profiles. It tests the screener's logic; it is never human IR and is never sent to Supply360 as one."
        actions={<ProjectPicker value={pid} onChange={setPid} />}
      />
      <SyntheticBanner>Synthetic path IR depends on which profiles the scenarios use.</SyntheticBanner>
      {stats.isLoading ? (
        <Loading />
      ) : !stats.data?.length ? (
        <Empty title="No QA projects yet" />
      ) : (
        <div className="space-y-6">
          {stats.data.map((s) => (
            <Card key={s.projectId}>
              <CardHeader title={`${s.code} · ${s.name}`} description={`${s.sessions} synthetic sessions`} />
              <CardBody className="grid gap-4 lg:grid-cols-3">
                <div className="grid grid-cols-2 gap-3 lg:col-span-1">
                  <Stat label="Synthetic path IR" value={pct(s.syntheticIrPercent)} hint="Not human IR" />
                  <Stat label="Expected IR" value={pct(s.expectedIrPercent)} hint="From the project brief" />
                  <Stat label="Assertions passed" value={pct(s.assertions.passRate)} hint={`${s.assertions.failed} failed`} tone={s.assertions.failed ? 'danger' : undefined} />
                  <Stat label="Open reviews" value={s.openReviews} />
                </div>
                <div className="lg:col-span-2">
                  <p className="mb-2 text-xs font-medium text-muted">Actual outcomes</p>
                  {Object.keys(s.outcomes).length ? (
                    <Bars rows={Object.entries(s.outcomes).map(([o, n]) => ({ label: SYNTHETIC_OUTCOME_LABELS[o as SyntheticOutcome] ?? o, n }))} />
                  ) : (
                    <p className="text-sm text-muted">No sessions yet.</p>
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
