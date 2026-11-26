'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Field, StateBadge, Table, Td, errMsg, when } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Empty, Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';

interface Token {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function Supply360LinkPage() {
  const can = useCan('integrations.read');
  const canManage = useCan('integrations.manage');
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const tokens = useQuery({ queryKey: ['integration', 'tokens'], queryFn: () => api<Token[]>('/integration/tokens'), enabled: can });
  const create = useMutation({
    mutationFn: (b: unknown) => api<{ token: string }>('/integration/tokens', { method: 'POST', body: b }),
    onSuccess: (r) => {
      setCreating(false);
      setShown(r.token);
      void qc.invalidateQueries({ queryKey: ['integration'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/integration/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Token revoked');
      void qc.invalidateQueries({ queryKey: ['integration'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!can) return <NoPermission permission="integrations.read" />;
  const onCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    create.mutate({ name: f.get('name'), scopes: ['qa_summary.read'], expiresInDays: Number(f.get('days')) });
  };
  const state = (t: Token) => (t.revokedAt ? 'revoked' : new Date(t.expiresAt) <= new Date() ? 'expired' : 'active');
  return (
    <>
      <PageHeader
        title="Supply360 link"
        description="Supply360 can show a synthetic QA summary on its project page when the project is set to Synthetic QA only or Both separate. It reads aggregates through a scoped token: no shared database, no question content, nothing human."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus /> Issue token
            </Button>
          )
        }
      />
      <Card className="mb-6">
        <CardBody className="space-y-1 text-sm">
          <p>
            Endpoint: <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs">GET /api/v1/integration/qa-summary?projectRef=PRX10001</code> with{' '}
            <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs">Authorization: Bearer sik…</code>
          </p>
          <p className="text-xs text-muted">Scope qa_summary.read. Returns project codes, synthetic outcome counts, assertion totals, blocked redirects and the last session time, always labelled synthetic_qa.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Service tokens" description="Only a hash of each secret is stored" />
        {tokens.isLoading ? (
          <Loading />
        ) : !tokens.data?.length ? (
          <Empty title="No tokens issued" />
        ) : (
          <Table head={['Name', 'Scopes', 'State', 'Expires', 'Last used', '']}>
            {tokens.data.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.name}</Td>
                <Td className="font-mono text-xs">{t.scopes.join(' ')}</Td>
                <Td>
                  <StateBadge s={state(t)} />
                </Td>
                <Td className="text-xs whitespace-nowrap">{when(t.expiresAt)}</Td>
                <Td className="text-xs whitespace-nowrap">{when(t.lastUsedAt)}</Td>
                <Td className="text-right">
                  {canManage && state(t) === 'active' && (
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(t.id)}>
                      <Trash2 /> Revoke
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Dialog open={creating} onOpenChange={setCreating} title="Issue a service token" description="Read-only access to synthetic QA summaries.">
        <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="t-name">
            <Input id="t-name" name="name" required minLength={3} defaultValue="Supply360" />
          </Field>
          <Field label="Valid for (days)" htmlFor="t-days">
            <Input id="t-days" name="days" type="number" min={1} max={365} defaultValue={90} />
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" variant="primary" disabled={create.isPending}>
              <KeyRound /> Issue
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)} title="Copy the token now" description="It is shown once. Paste it into Supply360 under Integrations, SampIntel AI.">
        <div className="space-y-3">
          <code className="block rounded-lg bg-surface-3 p-3 font-mono text-xs break-all" data-testid="new-token">
            {shown}
          </code>
          <Button
            onClick={() => {
              void navigator.clipboard?.writeText(shown ?? '');
              toast.success('Copied');
            }}
          >
            <Copy /> Copy
          </Button>
        </div>
      </Dialog>
    </>
  );
}
