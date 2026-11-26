'use client';
import { LANGUAGE_LABELS, QA_LANGUAGES } from '@si/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { Profile } from '@/components/qa/data';
import { Field, SyntheticBanner, Table, Td, errMsg } from '@/components/qa/kit';
import { PageHeader } from '@/components/page-header';
import { useCan } from '@/components/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Loading, NoPermission } from '@/components/ui/states';
import { api } from '@/lib/api';

const ENGINE = [
  ['Question type recognition', 'Maps each page input to single, multi, numeric, open, matrix, ranking or consent, and flags wording that implies another type.'],
  ['Language detection', 'Detects the language a question is shown in and flags a missing translation for the scenario language.'],
  ['Response memory', 'Answers within one test case come from one fictional profile, so age, band and country stay consistent.'],
  ['Consistency and logic checks', 'Age against age band, straightlined matrices, repeated open answers, incomplete rankings.'],
  ['Validation testing', 'Fixed out-of-range answers check that the survey rejects them; an accepted one is a high finding.'],
  ['Untrusted survey content', 'Text that tries to instruct a model is flagged and never sent to one; no secret ever enters a prompt.'],
];

export default function SyntheticPage() {
  const can = useCan('qa_projects.read');
  const canManage = useCan('scenarios.manage');
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const profiles = useQuery({ queryKey: ['qa', 'profiles'], queryFn: () => api<Profile[]>('/qa/profiles') });
  const add = useMutation({
    mutationFn: (b: unknown) => api('/qa/profiles', { method: 'POST', body: b }),
    onSuccess: () => {
      setAdding(false);
      toast.success('Fictional profile added');
      void qc.invalidateQueries({ queryKey: ['qa', 'profiles'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!can) return <NoPermission permission="qa_projects.read" />;
  const onAdd = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    add.mutate({
      label: s('label'),
      age: Number(s('age')),
      gender: s('gender'),
      country: s('country').toUpperCase(),
      language: s('language'),
      attributes: { groceryFrequency: s('freq'), onlineCategories: s('online').split(/[\s,]+/).filter(Boolean), brandAffinity: 3 },
    });
  };
  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="neutral">Module 4 of 19</Badge>}
        title="Synthetic Data Engine"
        description="A library of fictional profiles and the logic that answers test surveys as them. No real person, panel identity or human participation token is ever available to it."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus /> Add fictional profile
            </Button>
          )
        }
      />
      <SyntheticBanner />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Fictional profile library" description="Each built-in profile exercises a known path through the sandbox surveys" />
          {profiles.isLoading ? (
            <Loading />
          ) : (
            <Table head={['Code', 'Profile', 'Age', 'Country', 'Language', 'Attributes', '']}>
              {(profiles.data ?? []).map((p) => (
                <tr key={p.id} data-testid="profile-row">
                  <Td className="font-mono text-xs">{p.code}</Td>
                  <Td className="text-xs">{p.label.replace(/^Fictional profile [^:]+: /, '')}</Td>
                  <Td className="tabular-nums">{p.age}</Td>
                  <Td className="font-mono text-xs">{p.country}</Td>
                  <Td className="text-xs">{LANGUAGE_LABELS[p.language as keyof typeof LANGUAGE_LABELS] ?? p.language}</Td>
                  <Td className="max-w-64 font-mono text-[11px] text-muted">{JSON.stringify(p.attributes)}</Td>
                  <Td>{p.builtin ? <Badge>Built in</Badge> : <Badge tone="accent">Custom</Badge>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="What the engine does" />
          <ul className="divide-y divide-border">
            {ENGINE.map(([t, d]) => (
              <li key={t} className="flex gap-3 px-5 py-3">
                <Brain className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                <div>
                  <p className="text-sm font-medium">{t}</p>
                  <p className="text-xs text-muted">{d}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Dialog open={adding} onOpenChange={setAdding} title="Add a fictional profile" description="Describe a test case, not a person. Do not copy real panel data.">
        <form onSubmit={onAdd} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Label" htmlFor="pf-label">
              <Input id="pf-label" name="label" required minLength={3} defaultValue="34, India, monthly shopper" />
            </Field>
          </div>
          <Field label="Age" htmlFor="pf-age">
            <Input id="pf-age" name="age" type="number" min={10} max={99} required defaultValue={34} />
          </Field>
          <Field label="Gender" htmlFor="pf-gender">
            <Select id="pf-gender" name="gender" defaultValue="female">
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="non_binary">Non-binary</option>
            </Select>
          </Field>
          <Field label="Country (ISO code)" htmlFor="pf-country">
            <Input id="pf-country" name="country" required maxLength={2} defaultValue="IN" className="font-mono uppercase" />
          </Field>
          <Field label="Language" htmlFor="pf-language">
            <Select id="pf-language" name="language" defaultValue="en">
              {QA_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_LABELS[l]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Grocery frequency" htmlFor="pf-freq">
            <Select id="pf-freq" name="freq" defaultValue="monthly">
              {['weekly', 'fortnightly', 'monthly', 'rarely', 'never'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Buys online" htmlFor="pf-online" hint="produce, household, snacks, beverages">
            <Input id="pf-online" name="online" defaultValue="produce" />
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" variant="primary" disabled={add.isPending}>
              Add
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
