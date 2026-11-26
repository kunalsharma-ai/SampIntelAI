'use client';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet } from 'lucide-react';
import { SyntheticBanner, Table, Td, useProjects, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Empty, Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';

interface ExportRow {
  id: string;
  kind: string;
  projectCode: string | null;
  rows: number;
  questionContent: boolean;
  createdByEmail: string | null;
  createdAt: string;
}

export default function ReportsPage() {
  const can = useCan('reports.read');
  const canExport = useCan('reports.export');
  const projects = useProjects();
  const history = useQuery({ queryKey: ['qa', 'exports'], queryFn: () => api<ExportRow[]>('/qa/exports'), enabled: can, refetchInterval: 5000 });
  if (!can) return <NoPermission permission="reports.read" />;
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 15 of 19</Badge>}
        title="Excel Reporting"
        description="Separate synthetic exports, one row per session or per question, opening in Excel. Cells that a spreadsheet would run as a formula are neutralised, and question wording is withheld unless the authorization allows it."
      />
      <SyntheticBanner>Every file name starts with SYNTHETIC and every row carries the synthetic_qa classification.</SyntheticBanner>
      <Card>
        <CardHeader title="Export a QA project" />
        {projects.isLoading ? (
          <Loading />
        ) : !projects.data?.length ? (
          <Empty title="No QA projects yet" />
        ) : (
          <Table head={['Project', 'Sessions', 'Exports']}>
            {projects.data.map((p) => (
              <tr key={p.id}>
                <Td>
                  <span className="font-mono text-xs">{p.code}</span>
                  <p className="text-xs text-muted">{p.name}</p>
                </Td>
                <Td className="tabular-nums">{p.sessions}</Td>
                <Td className="space-x-2 whitespace-nowrap">
                  {canExport ? (
                    <>
                      <Button asChild size="sm">
                        <a href={`/api/v1/qa/exports/sessions.csv?projectId=${p.id}`} download>
                          <Download /> Sessions CSV
                        </a>
                      </Button>
                      <Button asChild size="sm">
                        <a href={`/api/v1/qa/exports/questions.csv?projectId=${p.id}`} download>
                          <FileSpreadsheet /> Question records CSV
                        </a>
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted">Needs reports.export</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card className="mt-6">
        <CardHeader title="Export history" description="Who exported what, and whether question wording was included" />
        {!history.data?.length ? (
          <Empty title="No exports yet" />
        ) : (
          <Table head={['When', 'Project', 'Kind', 'Rows', 'Question wording', 'By']}>
            {history.data.map((e) => (
              <tr key={e.id}>
                <Td className="text-xs whitespace-nowrap">{when(e.createdAt)}</Td>
                <Td className="font-mono text-xs">{e.projectCode ?? '—'}</Td>
                <Td className="text-xs">{e.kind}</Td>
                <Td className="tabular-nums">{e.rows}</Td>
                <Td className="text-xs">{e.kind === 'questions' ? (e.questionContent ? 'Included' : 'Withheld') : '—'}</Td>
                <Td className="text-xs">{e.createdByEmail}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
