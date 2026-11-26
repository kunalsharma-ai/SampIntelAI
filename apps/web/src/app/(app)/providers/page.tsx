'use client';
import { PROVIDER_LABELS, type Provider } from '@si/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, Lock } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field, Table, Td, errMsg, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';

interface Prov {
  provider: Provider;
  configured: boolean;
  model: string;
  hasKey: boolean;
  enabled: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  priceInputPerMTokUsd: number;
  priceOutputPerMTokUsd: number;
  live: boolean;
  callable: boolean;
  updatedAt: string | null;
}
interface Usage {
  recent: { id: string; at: string; provider: string; model: string; modelVersion: string | null; purpose: string; inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number; status: string; projectCode: string | null }[];
}

function ProviderCard({ p, canManage }: { p: Prov; canManage: boolean }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(p.enabled);
  const save = useMutation({
    mutationFn: (b: unknown) => api(`/ai/providers/${p.provider}`, { method: 'PUT', body: b }),
    onSuccess: () => {
      toast.success(`${PROVIDER_LABELS[p.provider]} saved`);
      void qc.invalidateQueries({ queryKey: ['ai'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Card data-testid={`provider-${p.provider}`}>
      <CardHeader
        title={PROVIDER_LABELS[p.provider]}
        description={p.live ? 'Live calls are switched off in this release, even with a key' : 'Deterministic answers for sandbox runs, no network'}
        action={p.enabled ? <Badge tone="success">Answering</Badge> : <Badge>Off</Badge>}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const key = String(f.get('key') ?? '');
          save.mutate({
            model: String(f.get('model')),
            ...(key ? { apiKey: key } : {}),
            enabled,
            timeoutMs: Number(f.get('timeout')),
            maxOutputTokens: Number(f.get('max')),
            priceInputPerMTokUsd: Number(f.get('pin')),
            priceOutputPerMTokUsd: Number(f.get('pout')),
          });
        }}
      >
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Model" htmlFor={`${p.provider}-model`} hint="Recorded with its version on every call">
            <Input id={`${p.provider}-model`} name="model" required defaultValue={p.model} disabled={!canManage} placeholder="Model id from your contract" />
          </Field>
          {p.live ? (
            <Field label="API key" htmlFor={`${p.provider}-key`} hint={p.hasKey ? 'A key is stored, sealed. Leave empty to keep it.' : 'Sealed at rest and never shown again'}>
              <Input id={`${p.provider}-key`} name="key" type="password" autoComplete="off" disabled={!canManage} placeholder={p.hasKey ? '••••••••' : ''} />
            </Field>
          ) : (
            <div className="flex items-end text-xs text-muted">
              <Lock className="mr-1.5 size-3.5" /> No key needed
            </div>
          )}
          <Field label="Timeout (ms)" htmlFor={`${p.provider}-timeout`}>
            <Input id={`${p.provider}-timeout`} name="timeout" type="number" min={1000} max={60000} defaultValue={p.timeoutMs} disabled={!canManage} />
          </Field>
          <Field label="Max output tokens" htmlFor={`${p.provider}-max`}>
            <Input id={`${p.provider}-max`} name="max" type="number" min={16} max={4096} defaultValue={p.maxOutputTokens} disabled={!canManage} />
          </Field>
          <Field label="Input price, USD per million tokens" htmlFor={`${p.provider}-pin`} hint="Your contract price; SampIntel never assumes one">
            <Input id={`${p.provider}-pin`} name="pin" type="number" step="0.001" min={0} defaultValue={p.priceInputPerMTokUsd} disabled={!canManage} />
          </Field>
          <Field label="Output price, USD per million tokens" htmlFor={`${p.provider}-pout`}>
            <Input id={`${p.provider}-pout`} name="pout" type="number" step="0.001" min={0} defaultValue={p.priceOutputPerMTokUsd} disabled={!canManage} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="accent-[var(--accent)]" checked={enabled} disabled={!canManage} onChange={(e) => setEnabled(e.target.checked)} />
            Use this provider for model answers (turns the others off)
          </label>
          {canManage && (
            <div className="flex items-center justify-between sm:col-span-2">
              <span className="text-xs text-muted">{p.updatedAt ? `Saved ${when(p.updatedAt)}` : 'Not configured yet'}</span>
              <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
                Save
              </Button>
            </div>
          )}
        </CardBody>
      </form>
    </Card>
  );
}

export default function ProvidersPage() {
  const can = useCan('qa_projects.read');
  const canManage = useCan('providers.manage');
  const list = useQuery({ queryKey: ['ai', 'providers'], queryFn: () => api<Prov[]>('/ai/providers'), enabled: can });
  const usage = useQuery({ queryKey: ['ai', 'usage'], queryFn: () => api<Usage>('/ai/usage'), enabled: can });
  if (!can) return <NoPermission permission="qa_projects.read" />;
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 16 of 19</Badge>}
        title="AI API Management"
        description="One gateway for Claude, OpenAI and Gemini: structured output checked against a schema, model version recorded, a timeout, and budgets checked before every call. Survey text is passed as untrusted data and no secret ever enters a prompt."
      />
      {list.isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {list.data?.map((p) => <ProviderCard key={p.provider} p={p} canManage={canManage} />)}
        </div>
      )}
      <Card className="mt-6">
        <CardHeader title="Recent model calls" description="Every call, including ones refused by a budget" />
        {!usage.data?.recent.length ? (
          <p className="flex items-center gap-2 p-5 text-sm text-muted">
            <Cpu className="size-4" /> No model calls yet.
          </p>
        ) : (
          <Table head={['When', 'Project', 'Provider', 'Model version', 'Tokens in/out', 'Cost', 'Latency', 'Status']}>
            {usage.data.recent.map((u) => (
              <tr key={u.id}>
                <Td className="text-xs whitespace-nowrap">{when(u.at)}</Td>
                <Td className="font-mono text-xs">{u.projectCode ?? '—'}</Td>
                <Td className="text-xs">{u.provider}</Td>
                <Td className="font-mono text-xs">{u.modelVersion ?? u.model}</Td>
                <Td className="text-xs tabular-nums">
                  {u.inputTokens} / {u.outputTokens}
                </Td>
                <Td className="text-xs tabular-nums">${u.costUsd.toFixed(6)}</Td>
                <Td className="text-xs tabular-nums">{u.latencyMs} ms</Td>
                <Td>
                  <Badge tone={u.status === 'ok' ? 'success' : 'danger'}>{u.status.replaceAll('_', ' ')}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
