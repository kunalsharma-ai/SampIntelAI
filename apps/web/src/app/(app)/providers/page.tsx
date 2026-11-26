'use client';
import { AI_PRESETS, PROVIDER_KIND_LABELS, type AiPreset, type AuthStyle, type ProviderKind } from '@si/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Cpu, ExternalLink, ListRestart, Lock, Plus, Trash2, XCircle, Zap } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Field, Table, Td, errMsg, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';

interface Conn {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string | null;
  authStyle: AuthStyle;
  configured: boolean;
  model: string;
  hasKey: boolean;
  enabled: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  priceInputPerMTokUsd: number;
  priceOutputPerMTokUsd: number;
  live: boolean;
  updatedAt: string | null;
}
interface Usage {
  recent: {
    id: string;
    at: string;
    provider: string;
    model: string;
    modelVersion: string | null;
    purpose: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
    status: string;
    projectCode: string | null;
  }[];
}
interface TestResult {
  ok: boolean;
  reason: string | null;
  detail: string | null;
  modelVersion: string | null;
  latencyMs: number | null;
  sample: string | null;
}

const REASONS: Record<string, string> = {
  auth_failed: 'The provider refused the key. Check it was copied in full and is still active.',
  rate_limited: 'The provider’s rate limit was hit. Free tiers allow only a few calls a minute, so try again shortly.',
  model_not_found: 'The provider does not know this model id. Use “Load models” to pick one.',
  timeout: 'No answer within the timeout. Raise the timeout or choose a faster model.',
  network_error: 'The provider could not be reached.',
  provider_error: 'The provider returned an error.',
  invalid_output:
    'The model answered, but not in the JSON shape SampIntel asks for. A larger model usually fixes this.',
  refused_budget: 'A budget on the Budgets page would be exceeded.',
  key_required: 'Enter the API key first.',
  base_url_required: 'Enter the base URL first.',
  address_host_not_found: 'That address could not be found. Check the base URL.',
  address_host_not_public: 'Only public internet addresses can be used, not local or private ones.',
  address_https_required: 'Use an https:// address.',
};
const reasonText = (r: string | null, d: string | null) =>
  [r ? (REASONS[r] ?? r.replaceAll('_', ' ')) : null, d].filter(Boolean).join(' ');

function slug(label: string, taken: string[]) {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34) || 'ai';
  const b = base.length < 2 ? `${base}-ai` : base;
  if (b === 'fixture' || taken.includes(b)) {
    for (let i = 2; ; i++) if (!taken.includes(`${b}-${i}`)) return `${b}-${i}`;
  }
  return b;
}

interface Draft {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  authStyle: AuthStyle;
  model: string;
  enabled: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  priceIn: number;
  priceOut: number;
}

function ConnectionForm({
  initial,
  isNew,
  hasKey,
  canManage,
  preset,
  onSaved,
}: {
  initial: Draft;
  isNew: boolean;
  hasKey: boolean;
  canManage: boolean;
  preset?: AiPreset;
  onSaved?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const uid = useId();
  const [d, setD] = useState(initial);
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<TestResult | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const live = d.kind !== 'fixture';
  const compat = d.kind === 'openai_compatible';
  const addressChanged = !isNew && (d.baseUrl !== initial.baseUrl || d.authStyle !== initial.authStyle);

  const save = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/ai/providers/${d.id}`, {
        method: 'PUT',
        body: {
          kind: d.kind,
          label: d.label,
          ...(live && d.baseUrl.trim() ? { baseUrl: d.baseUrl.trim() } : {}),
          authStyle: d.authStyle,
          model: d.model.trim(),
          ...(key.trim() ? { apiKey: key.trim() } : {}),
          enabled: d.enabled,
          timeoutMs: d.timeoutMs,
          maxOutputTokens: d.maxOutputTokens,
          priceInputPerMTokUsd: d.priceIn,
          priceOutputPerMTokUsd: d.priceOut,
        },
      }),
    onSuccess: (r) => {
      toast.success(`${d.label} saved`);
      setKey('');
      void qc.invalidateQueries({ queryKey: ['ai'] });
      onSaved?.(r.id);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const runTest = useMutation({
    mutationFn: () => api<TestResult>(`/ai/providers/${d.id}/test`, { method: 'POST' }),
    onSuccess: (r) => {
      setTest(r);
      void qc.invalidateQueries({ queryKey: ['ai', 'usage'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const loadModels = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; models: string[]; reason: string | null; detail: string | null }>('/ai/models', {
        method: 'POST',
        body: {
          kind: d.kind,
          ...(d.baseUrl.trim() ? { baseUrl: d.baseUrl.trim() } : {}),
          authStyle: d.authStyle,
          ...(key.trim() ? { apiKey: key.trim() } : {}),
          ...(!isNew ? { connection: d.id } : {}),
        },
      }),
    onSuccess: (r) => {
      if (!r.ok) return toast.error(reasonText(r.reason, r.detail));
      setModels(r.models);
      toast.success(`${r.models.length} models found`);
      if (!d.model && r.models[0]) set('model', r.models.find((m) => m.endsWith(':free')) ?? r.models[0]);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const removeIt = useMutation({
    mutationFn: () => api(`/ai/providers/${d.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(`${d.label} removed`);
      void qc.invalidateQueries({ queryKey: ['ai'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const f = (s: string) => `${uid}-${s}`;
  const off = !canManage;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <CardBody className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={f('label')} hint={isNew ? `Saved as “${d.id}”` : undefined}>
          <Input
            id={f('label')}
            required
            minLength={2}
            maxLength={60}
            value={d.label}
            disabled={off || d.kind === 'fixture'}
            onChange={(e) => set('label', e.target.value)}
          />
        </Field>
        <Field
          label="API type"
          htmlFor={f('kind')}
          hint={compat ? 'Works with any AI that offers an OpenAI-style API' : undefined}
        >
          <Select
            id={f('kind')}
            value={d.kind}
            disabled={off || d.kind === 'fixture' || !isNew}
            onChange={(e) => set('kind', e.target.value as ProviderKind)}
          >
            {(['anthropic', 'openai', 'gemini', 'openai_compatible'] as const).map((k) => (
              <option key={k} value={k}>
                {PROVIDER_KIND_LABELS[k]}
              </option>
            ))}
            {d.kind === 'fixture' && <option value="fixture">{PROVIDER_KIND_LABELS.fixture}</option>}
          </Select>
        </Field>
        {live && (
          <Field
            label={compat ? 'Base URL' : 'Base URL (optional)'}
            htmlFor={f('base')}
            hint={
              preset?.note ??
              (compat
                ? 'From the provider’s API docs, usually ending in /v1'
                : 'Leave empty for the provider’s own address')
            }
          >
            <Input
              id={f('base')}
              type="url"
              required={compat}
              pattern="https://.*"
              placeholder="https://"
              value={d.baseUrl}
              disabled={off}
              onChange={(e) => set('baseUrl', e.target.value)}
            />
          </Field>
        )}
        {compat && (
          <Field label="Key is sent as" htmlFor={f('auth')}>
            <Select
              id={f('auth')}
              value={d.authStyle}
              disabled={off}
              onChange={(e) => set('authStyle', e.target.value as AuthStyle)}
            >
              <option value="bearer">Authorization: Bearer (most providers)</option>
              <option value="api-key">api-key header (Azure OpenAI)</option>
            </Select>
          </Field>
        )}
        {live ? (
          <Field
            label="API key"
            htmlFor={f('key')}
            hint={
              <>
                {addressChanged && hasKey
                  ? 'The address changed, so enter the key again. '
                  : hasKey
                    ? 'A key is stored, sealed. Leave empty to keep it. '
                    : 'Sealed at rest and never shown again. '}
                {preset?.keyPage && (
                  <a
                    href={preset.keyPage}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-0.5 text-accent hover:underline"
                  >
                    Get a key <ExternalLink className="size-3" />
                  </a>
                )}
              </>
            }
          >
            <Input
              id={f('key')}
              type="password"
              autoComplete="off"
              disabled={off}
              value={key}
              placeholder={hasKey ? '••••••••' : ''}
              onChange={(e) => setKey(e.target.value)}
            />
          </Field>
        ) : (
          <div className="flex items-end text-xs text-muted">
            <Lock className="mr-1.5 size-3.5" /> No key needed
          </div>
        )}
        <Field label="Model" htmlFor={f('model')} hint="Recorded with its version on every call">
          <div className="flex gap-2">
            <Input
              id={f('model')}
              list={f('models')}
              required
              value={d.model}
              disabled={off || d.kind === 'fixture'}
              placeholder="Model id, or load the list"
              onChange={(e) => set('model', e.target.value)}
            />
            <datalist id={f('models')}>
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {live && canManage && (
              <Button
                type="button"
                size="sm"
                className="h-9 shrink-0"
                disabled={loadModels.isPending}
                onClick={() => loadModels.mutate()}
                title="Ask the provider which models this key can use"
              >
                <ListRestart /> Load models
              </Button>
            )}
          </div>
        </Field>
        <Field label="Timeout (ms)" htmlFor={f('timeout')}>
          <Input
            id={f('timeout')}
            type="number"
            min={1000}
            max={120000}
            value={d.timeoutMs}
            disabled={off}
            onChange={(e) => set('timeoutMs', Number(e.target.value))}
          />
        </Field>
        <Field label="Max output tokens" htmlFor={f('max')}>
          <Input
            id={f('max')}
            type="number"
            min={16}
            max={16000}
            value={d.maxOutputTokens}
            disabled={off}
            onChange={(e) => set('maxOutputTokens', Number(e.target.value))}
          />
        </Field>
        <Field
          label="Input price, USD per million tokens"
          htmlFor={f('pin')}
          hint="Your contract price; 0 for a free tier"
        >
          <Input
            id={f('pin')}
            type="number"
            step="0.001"
            min={0}
            value={d.priceIn}
            disabled={off}
            onChange={(e) => set('priceIn', Number(e.target.value))}
          />
        </Field>
        <Field label="Output price, USD per million tokens" htmlFor={f('pout')}>
          <Input
            id={f('pout')}
            type="number"
            step="0.001"
            min={0}
            value={d.priceOut}
            disabled={off}
            onChange={(e) => set('priceOut', Number(e.target.value))}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={d.enabled}
            disabled={off}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          Use this AI for model answers (turns the others off)
        </label>
        {test && (
          <div
            data-testid="test-result"
            className={`flex items-start gap-2 rounded-lg border p-3 text-sm sm:col-span-2 ${test.ok ? 'border-success/30 bg-success/10' : 'border-danger/30 bg-danger/10'}`}
          >
            {test.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
            )}
            <div>
              {test.ok ? (
                <>
                  <p className="font-medium">
                    Working. {test.modelVersion} answered in {test.latencyMs} ms.
                  </p>
                  {test.sample && <p className="mt-1 text-muted">“{test.sample}”</p>}
                </>
              ) : (
                <p>{reasonText(test.reason, test.detail)}</p>
              )}
            </div>
          </div>
        )}
        {canManage && (
          <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
            <span className="text-xs text-muted">
              {isNew ? 'After saving, use Test to send one small fictional question' : ''}
            </span>
            <div className="flex gap-2">
              {!isNew && d.kind !== 'fixture' && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={removeIt.isPending}
                  onClick={() => removeIt.mutate()}
                  aria-label={`Remove ${d.label}`}
                >
                  <Trash2 /> Remove
                </Button>
              )}
              {!isNew && (
                <Button type="button" size="sm" disabled={runTest.isPending} onClick={() => runTest.mutate()}>
                  <Zap /> {runTest.isPending ? 'Testing…' : 'Test'}
                </Button>
              )}
              <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
                {isNew ? 'Add AI' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </form>
  );
}

const draftOf = (c: Conn): Draft => ({
  id: c.id,
  kind: c.kind,
  label: c.label,
  baseUrl: c.baseUrl ?? '',
  authStyle: c.authStyle,
  model: c.model,
  enabled: c.enabled,
  timeoutMs: c.timeoutMs,
  maxOutputTokens: c.maxOutputTokens,
  priceIn: c.priceInputPerMTokUsd,
  priceOut: c.priceOutputPerMTokUsd,
});

function AddAi({ open, onOpenChange, taken }: { open: boolean; onOpenChange: (o: boolean) => void; taken: string[] }) {
  const [preset, setPreset] = useState<AiPreset | null>(null);
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setPreset(null);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      wide
      title={preset ? `Add ${preset.label}` : 'Add an AI'}
      description={
        preset
          ? 'Paste your key, pick a model, and save. Nothing is turned on until you tick the box.'
          : 'Pick a provider, or “Any other AI” for one not listed. Free tiers are the provider’s own offer and can change.'
      }
    >
      {!preset ? (
        <div className="grid gap-2 sm:grid-cols-3" data-testid="ai-presets">
          {AI_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p)}
              className="flex flex-col items-start gap-1 rounded-lg border border-border bg-surface-2 p-3 text-left text-sm hover:border-accent/60 hover:bg-surface-3"
            >
              <span className="font-medium">{p.label}</span>
              <span className="flex gap-1">
                {p.freeTier && <Badge tone="success">Free tier</Badge>}
                <Badge>{p.kind === 'openai_compatible' ? 'OpenAI-style' : p.kind}</Badge>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <ConnectionForm
            key={preset.id}
            isNew
            hasKey={false}
            canManage
            preset={preset}
            initial={{
              id: slug(preset.id === 'custom' ? 'custom-ai' : preset.id, taken),
              kind: preset.kind,
              label: preset.id === 'custom' ? 'My AI' : preset.label,
              baseUrl: preset.baseUrl ?? '',
              authStyle: preset.authStyle ?? 'bearer',
              model: preset.model ?? '',
              enabled: false,
              timeoutMs: 30_000,
              maxOutputTokens: preset.maxOutputTokens ?? 600,
              priceIn: 0,
              priceOut: 0,
            }}
            onSaved={() => close(false)}
          />
          <button type="button" className="mt-1 text-xs text-muted hover:text-text" onClick={() => setPreset(null)}>
            ← Choose another provider
          </button>
        </>
      )}
    </Dialog>
  );
}

export default function ProvidersPage() {
  const can = useCan('qa_projects.read');
  const canManage = useCan('providers.manage');
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ['ai', 'providers'], queryFn: () => api<Conn[]>('/ai/providers'), enabled: can });
  const usage = useQuery({ queryKey: ['ai', 'usage'], queryFn: () => api<Usage>('/ai/usage'), enabled: can });
  if (!can) return <NoPermission permission="qa_projects.read" />;
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 16 of 19</Badge>}
        title="AI API Management"
        description="Add any AI from this screen: Claude, OpenAI, Gemini, free tiers such as Groq, OpenRouter or Mistral, or any service with an OpenAI-style API. Every call is checked against a schema and a budget, the model version is recorded, survey text is passed as untrusted data, and no key ever enters a prompt."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus /> Add AI
            </Button>
          )
        }
      />
      {list.isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {list.data?.map((c) => (
            <Card key={`${c.id}:${c.updatedAt}`} data-testid={`provider-${c.id}`}>
              <CardHeader
                title={c.label}
                description={
                  c.kind === 'fixture'
                    ? 'Deterministic answers for sandbox runs, no network'
                    : `${PROVIDER_KIND_LABELS[c.kind]}${c.baseUrl ? ` at ${new URL(c.baseUrl).host}` : ''}`
                }
                action={c.enabled ? <Badge tone="success">Answering</Badge> : <Badge>Off</Badge>}
              />
              <ConnectionForm
                initial={draftOf(c)}
                isNew={false}
                hasKey={c.hasKey}
                canManage={canManage}
                preset={AI_PRESETS.find((p) => p.baseUrl && p.baseUrl === c.baseUrl)}
              />
              {c.updatedAt && <p className="px-5 pb-4 text-xs text-muted">Saved {when(c.updatedAt)}</p>}
            </Card>
          ))}
        </div>
      )}
      <AddAi open={adding} onOpenChange={setAdding} taken={list.data?.map((c) => c.id) ?? []} />
      <Card className="mt-6">
        <CardHeader
          title="Recent model calls"
          description="Every call, including tests, failures and ones refused by a budget"
        />
        {!usage.data?.recent.length ? (
          <p className="flex items-center gap-2 p-5 text-sm text-muted">
            <Cpu className="size-4" /> No model calls yet.
          </p>
        ) : (
          <Table
            head={['When', 'Project', 'AI', 'Purpose', 'Model version', 'Tokens in/out', 'Cost', 'Latency', 'Status']}
          >
            {usage.data.recent.map((u) => (
              <tr key={u.id}>
                <Td className="text-xs whitespace-nowrap">{when(u.at)}</Td>
                <Td className="font-mono text-xs">{u.projectCode ?? '—'}</Td>
                <Td className="text-xs">{u.provider}</Td>
                <Td className="text-xs">{u.purpose === 'connection_test' ? 'Test' : 'Answer'}</Td>
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
