'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Bars, Field, ProjectPicker, Stat, Table, Td, errMsg, useProjects, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Empty, Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

interface Budget {
  id: string;
  scope: 'tenant' | 'project';
  projectCode: string | null;
  period: 'day' | 'month';
  limitUsd: number;
  spentUsd: number;
  percent: number;
  since: string | null;
}
interface Usage {
  byDay: { day: string; calls: number; costUsd: number }[];
  totals: { provider: string; model: string; status: string; calls: number; costUsd: number }[];
}
const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;

export default function BudgetsPage() {
  const can = useCan('qa_projects.read');
  const canManage = useCan('budgets.manage');
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [scope, setScope] = useState<'tenant' | 'project'>('tenant');
  const [picked, setPid] = useState('');
  const projects = useProjects();
  const pid = picked || projects.data?.[0]?.id || '';
  const budgets = useQuery({ queryKey: ['ai', 'budgets'], queryFn: () => api<Budget[]>('/ai/budgets'), enabled: can });
  const usage = useQuery({ queryKey: ['ai', 'usage'], queryFn: () => api<Usage>('/ai/usage'), enabled: can });
  const done = (m: string) => {
    toast.success(m);
    void qc.invalidateQueries({ queryKey: ['ai'] });
  };
  const save = useMutation({
    mutationFn: (b: unknown) => api('/ai/budgets', { method: 'PUT', body: b }),
    onSuccess: () => {
      setAdding(false);
      done('Budget saved');
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/ai/budgets/${id}`, { method: 'DELETE' }), onSuccess: () => done('Budget removed'), onError: (e) => toast.error(errMsg(e)) });
  if (!can) return <NoPermission permission="qa_projects.read" />;
  const month = (usage.data?.byDay ?? []).reduce((n, d) => n + d.costUsd, 0);
  const calls = (usage.data?.byDay ?? []).reduce((n, d) => n + d.calls, 0);
  const refused = (usage.data?.totals ?? []).filter((t) => t.status === 'refused_budget').reduce((n, t) => n + t.calls, 0);
  const onSave = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({ scope, ...(scope === 'project' ? { projectId: pid } : {}), period: f.get('period'), limitUsd: Number(f.get('limit')) });
  };
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 17 of 19</Badge>}
        title="AI API Cost and Budgets"
        description="Daily and monthly limits for the workspace and for each QA project. The gateway checks the worst-case cost of a call against every budget that covers it before calling; a job that would pass a limit stops."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus /> Set budget
            </Button>
          )
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Spend, last 30 days" value={usd(month)} hint="At the prices you entered" />
        <Stat label="Model calls, last 30 days" value={calls} />
        <Stat label="Calls refused by a budget" value={refused} tone={refused ? 'danger' : undefined} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Budgets" />
          {budgets.isLoading ? (
            <Loading />
          ) : !budgets.data?.length ? (
            <Empty title="No budgets set">Without a budget, model calls are limited only by provider timeouts and output caps.</Empty>
          ) : (
            <Table head={['Scope', 'Period', 'Used', 'Limit', '']}>
              {budgets.data.map((b) => (
                <tr key={b.id} data-testid="budget-row">
                  <Td className="text-xs">{b.scope === 'tenant' ? 'Whole workspace' : <span className="font-mono">{b.projectCode}</span>}</Td>
                  <Td className="text-xs">{b.period === 'day' ? 'Per day (UTC)' : 'Per month (UTC)'}</Td>
                  <Td className="min-w-48">
                    <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                      <div className={cn('h-full', b.percent >= 100 ? 'bg-danger' : b.percent >= 80 ? 'bg-warning' : 'bg-accent')} style={{ width: `${Math.min(100, b.percent)}%` }} />
                    </div>
                    <p className="mt-1 text-xs tabular-nums">
                      {usd(b.spentUsd)} ({b.percent}%) since {when(b.since)}
                    </p>
                  </Td>
                  <Td className="tabular-nums">{usd(b.limitUsd)}</Td>
                  <Td className="text-right">
                    {canManage && (
                      <Button size="sm" variant="ghost" aria-label="Remove budget" onClick={() => del.mutate(b.id)}>
                        <Trash2 />
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Spend by day" />
          <CardBody>{usage.data?.byDay.length ? <Bars rows={usage.data.byDay.map((d) => ({ label: d.day, n: Math.round(d.costUsd * 10000) / 10000 }))} unit=" $" /> : <p className="text-sm text-muted">No spend yet.</p>}</CardBody>
        </Card>
      </div>
      <Dialog open={adding} onOpenChange={setAdding} title="Set a budget" description="Replaces the existing limit for the same scope and period.">
        <form onSubmit={onSave} className="grid gap-3 sm:grid-cols-2">
          <Field label="Scope" htmlFor="b-scope">
            <Select id="b-scope" value={scope} onChange={(e) => setScope(e.target.value as 'tenant' | 'project')}>
              <option value="tenant">Whole workspace</option>
              <option value="project">One QA project</option>
            </Select>
          </Field>
          <Field label="Period" htmlFor="b-period">
            <Select id="b-period" name="period" defaultValue="month">
              <option value="day">Per day</option>
              <option value="month">Per month</option>
            </Select>
          </Field>
          {scope === 'project' && (
            <div className="sm:col-span-2">
              <Field label="QA project" htmlFor="b-project">
                <ProjectPicker id="b-project" value={pid} onChange={setPid} allowAll={false} />
              </Field>
            </div>
          )}
          <Field label="Limit, USD" htmlFor="b-limit">
            <Input id="b-limit" name="limit" type="number" step="0.0001" min="0.0001" required defaultValue={25} />
          </Field>
          <div className="flex items-end justify-end">
            <Button type="submit" variant="primary" disabled={save.isPending}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
