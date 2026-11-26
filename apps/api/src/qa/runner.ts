import { createHash } from 'node:crypto';
import type { QaLanguage, SyntheticOutcome } from '@si/contracts';
import type { Answer, DriverSession, PublicQuestion, SurveyDriver } from './fixture-surveys.js';
import { detectLanguage, looksLikeInjection, recognize, ruleAnswer, type ProfileView } from './recognize.js';

/**
 * Runs one synthetic QA session against approved test surveys. It records what actually happened; the scenario's
 * objective is an expectation checked afterwards, never a disposition the runner steers towards.
 */

export interface ScenarioView {
  id: string;
  objective: 'complete_path' | 'terminate_path' | 'any';
  language: QaLanguage;
  timing: 'nominal' | 'slow_pages' | 'timeout';
  answerStrategy: 'rules' | 'model';
  assertions: { expectOutcome?: SyntheticOutcome; maxLoiSeconds?: number; requiredQuestions?: string[] };
  overrides: Record<string, Answer>;
}

export interface QuestionRecord {
  seq: number;
  stage: 'gate' | 'client';
  questionId: string;
  questionText: string;
  inputKind: string;
  detectedType: string;
  topic: string | null;
  language: QaLanguage;
  answer: Answer | null;
  answeredBy: 'rules' | 'model' | 'override';
  validation: string;
  flags: string[];
  seconds: number;
}

export interface Finding {
  kind: string;
  severity: 'info' | 'low' | 'medium' | 'high';
  questionId?: string;
  detail: string;
}

export interface RunResult {
  outcome: SyntheticOutcome;
  stopReason: string | null;
  lastStage: 'gate' | 'client';
  loiSeconds: number;
  records: QuestionRecord[];
  redirect: { url: string; host: string; allowed: boolean; outcome: string | null } | null;
  validations: { assertion: string; passed: boolean; expected: string | null; actual: string | null }[];
  findings: Finding[];
  score: number;
  security: { kind: string; severity: 'medium' | 'high'; detail: Record<string, unknown> }[];
  versions: { stage: 'gate' | 'client'; url: string; fingerprint: string; questionIds: string[] }[];
}

export type ModelAnswer = (q: PublicQuestion, profile: ProfileView) => Promise<{ answer: string } | { invalid: true }>;

export class BudgetStop extends Error {
  constructor() {
    super('budget_limit');
  }
}

export const PAGE_TIMEOUT_SECONDS = 60;
const READ_SECONDS: Record<string, number> = { consent: 4, radio: 6, checkbox: 9, number: 5, text: 25, grid: 20, rank: 15 };
const latency = (timing: ScenarioView['timing'], page: number) =>
  timing === 'slow_pages' ? 20 : timing === 'timeout' && page === 3 ? PAGE_TIMEOUT_SECONDS + 15 : 1;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export async function runSession(input: {
  drivers: SurveyDriver[];
  urls: { gate?: string | null; client: string };
  allowedHosts: string[];
  scenario: ScenarioView;
  profile: ProfileView;
  seed: string;
  expectedLoiMinutes?: number | null;
  model?: ModelAnswer;
}): Promise<RunResult> {
  const { scenario: sc, profile } = input;
  const allowed = new Set(input.allowedHosts.map((h) => h.toLowerCase()));
  const records: QuestionRecord[] = [];
  const findings: Finding[] = [];
  const security: RunResult['security'] = [];
  const versions: RunResult['versions'] = [];
  let seconds = 0;
  let page = 0;
  let openIndex = 0;
  let redirect: RunResult['redirect'] = null;
  let outcome: SyntheticOutcome = 'error';
  let stopReason: string | null = null;
  let lastStage: 'gate' | 'client' = input.urls.gate ? 'gate' : 'client';

  const stages: ['gate' | 'client', string][] = [];
  if (input.urls.gate) stages.push(['gate', input.urls.gate]);
  stages.push(['client', input.urls.client]);

  stage: for (const [stageName, url] of stages) {
    lastStage = stageName;
    if (!allowed.has(hostOf(url))) {
      outcome = 'navigation_stop';
      stopReason = 'endpoint_not_allowed';
      security.push({ kind: 'endpoint_refused', severity: 'high', detail: { url, stage: stageName } });
      break;
    }
    const driver = input.drivers.find((d) => d.canOpen(url));
    if (!driver) {
      outcome = 'error';
      stopReason = 'driver_unavailable';
      break;
    }
    const s: DriverSession = driver.open(url, sc.language);
    const seen: string[] = [];
    // The same array fills as pages are met, so a stage that ends early still records what it saw.
    versions.push({
      stage: stageName,
      url,
      fingerprint: createHash('sha256').update(s.survey.questionIds.join(',')).digest('hex').slice(0, 16),
      questionIds: seen,
    });
    for (let step = 0; step < 200; step++) {
      const p = s.current();
      if (p.kind === 'challenge') {
        outcome = 'security_stop';
        stopReason = 'security_challenge';
        security.push({ kind: 'security_challenge', severity: 'high', detail: { stage: stageName, questionId: p.questionId } });
        break stage;
      }
      if (p.kind === 'redirect') {
        const host = hostOf(p.url);
        const ok = allowed.has(host);
        const status = ok ? new URL(p.url).searchParams.get('status') : null;
        redirect = { url: p.url, host, allowed: ok, outcome: status };
        if (!ok) {
          outcome = 'navigation_stop';
          stopReason = 'unexpected_navigation';
          security.push({ kind: 'unexpected_navigation', severity: 'high', detail: { stage: stageName, host } });
          break stage;
        }
        outcome = status === 'complete' || status === 'terminate' || status === 'quota_full' ? status : 'error';
        if (stageName === 'gate' && outcome === 'complete') break; // on to the client survey
        break stage;
      }
      const q = p.question;
      seen.push(q.id);
      page += 1;
      const pageSeconds = READ_SECONDS[q.inputKind]! + latency(sc.timing, page);
      seconds += pageSeconds;
      const rec = recognize(q);
      const flags: string[] = [];
      if (rec.mismatch) flags.push('type_mismatch');
      const lang = q.language;
      if (lang !== sc.language || detectLanguage(q.text) !== sc.language) flags.push('localization_missing');
      const injected = looksLikeInjection(q.text);
      if (injected) {
        flags.push('prompt_injection_suspected');
        security.push({ kind: 'prompt_injection_suspected', severity: 'medium', detail: { stage: stageName, questionId: q.id } });
      }
      if (latency(sc.timing, page) > PAGE_TIMEOUT_SECONDS) {
        records.push({
          seq: records.length + 1,
          stage: stageName,
          questionId: q.id,
          questionText: q.text,
          inputKind: q.inputKind,
          detectedType: rec.type,
          topic: rec.topic,
          language: lang,
          answer: null,
          answeredBy: 'rules',
          validation: 'not_answered:page_timeout',
          flags,
          seconds: pageSeconds,
        });
        outcome = 'timeout';
        stopReason = null;
        break stage;
      }

      let answer: Answer;
      let by: QuestionRecord['answeredBy'] = 'rules';
      if (q.id in sc.overrides) {
        answer = sc.overrides[q.id]!;
        by = 'override';
      } else if (sc.answerStrategy === 'model' && rec.type === 'open' && !injected && input.model) {
        const m = await input.model(q, profile);
        if ('answer' in m) {
          answer = m.answer;
          by = 'model';
        } else {
          flags.push('model_output_invalid');
          answer = ruleAnswer(q, rec.topic, profile, input.seed, openIndex);
        }
      } else {
        answer = ruleAnswer(q, rec.topic, profile, input.seed, openIndex);
      }
      if (rec.type === 'open') openIndex += 1;

      let res = s.submit(answer);
      let validation = res.accepted ? 'accepted' : `rejected:${res.message ?? ''}`;
      const outOfRange =
        typeof answer === 'number' && ((q.min !== undefined && answer < q.min) || (q.max !== undefined && answer > q.max));
      if (by === 'override' && outOfRange) {
        findings.push(
          res.accepted
            ? { kind: 'validation_missing', severity: 'high', questionId: q.id, detail: `Accepted ${answer} outside ${q.min} to ${q.max}` }
            : { kind: 'validation_fired', severity: 'info', questionId: q.id, detail: `Rejected ${answer}: ${res.message}` },
        );
      }
      if (!res.accepted) {
        // Record the rejection, then answer from the profile so the path can be finished.
        records.push({
          seq: records.length + 1,
          stage: stageName,
          questionId: q.id,
          questionText: q.text,
          inputKind: q.inputKind,
          detectedType: rec.type,
          topic: rec.topic,
          language: lang,
          answer,
          answeredBy: by,
          validation,
          flags: [...flags],
          seconds: pageSeconds,
        });
        answer = ruleAnswer(q, rec.topic, profile, input.seed, openIndex);
        by = 'rules';
        res = s.submit(answer);
        validation = res.accepted ? 'accepted' : `rejected:${res.message ?? ''}`;
        seconds += 3;
        if (!res.accepted) {
          outcome = 'error';
          stopReason = null;
          break stage;
        }
      }
      records.push({
        seq: records.length + 1,
        stage: stageName,
        questionId: q.id,
        questionText: q.text,
        inputKind: q.inputKind,
        detectedType: rec.type,
        topic: rec.topic,
        language: lang,
        answer,
        answeredBy: by,
        validation,
        flags,
        seconds: pageSeconds,
      });
    }
  }

  findings.push(...assess(records, seconds, input.expectedLoiMinutes ?? null));
  const validations = assertionsFor(sc, outcome, seconds, records, redirect, findings);
  const weights = { info: 0, low: 5, medium: 12, high: 25 } as const;
  const score = Math.max(0, 100 - findings.reduce((n, f) => n + weights[f.severity], 0));
  return { outcome, stopReason, lastStage, loiSeconds: seconds, records, redirect, validations, findings, score, security, versions };
}

const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\d]+/gu) ?? []);
export function jaccard(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  const inter = [...x].filter((w) => y.has(w)).length;
  return inter / Math.max(1, new Set([...x, ...y]).size);
}

/** Quality findings: contextual and reviewable, never an automatic rejection. */
export function assess(records: QuestionRecord[], seconds: number, expectedLoiMinutes: number | null): Finding[] {
  const out: Finding[] = [];
  const accepted = records.filter((r) => r.validation === 'accepted');
  for (const r of accepted) {
    if (r.inputKind === 'grid' && r.answer && typeof r.answer === 'object' && !Array.isArray(r.answer)) {
      const vals = Object.values(r.answer);
      if (vals.length > 2 && new Set(vals).size === 1)
        out.push({ kind: 'straightlining', severity: 'medium', questionId: r.questionId, detail: `Every row answered ${vals[0]}` });
    }
    if (r.inputKind === 'rank' && Array.isArray(r.answer) && new Set(r.answer).size !== r.answer.length)
      out.push({ kind: 'ranking_invalid', severity: 'medium', questionId: r.questionId, detail: 'Duplicate rank' });
  }
  const open = accepted.filter((r) => r.inputKind === 'text' && typeof r.answer === 'string');
  for (let i = 0; i < open.length; i++)
    for (let j = i + 1; j < open.length; j++)
      if (jaccard(open[i]!.answer as string, open[j]!.answer as string) > 0.6)
        out.push({
          kind: 'repetition',
          severity: 'low',
          questionId: open[j]!.questionId,
          detail: `Repeats ${open[i]!.questionId}`,
        });
  const age = accepted.find((r) => r.topic === 'age')?.answer;
  const bandRec = accepted.find((r) => r.topic === 'age_band');
  if (typeof age === 'number' && typeof bandRec?.answer === 'string') {
    const [lo, hi] = bandRec.answer === '55+' ? [55, 200] : bandRec.answer.split('-').map(Number);
    if (age < lo! || age > hi!)
      out.push({ kind: 'inconsistent_age', severity: 'high', questionId: bandRec.questionId, detail: `Age ${age}, band ${bandRec.answer}` });
  }
  const once = new Set<string>();
  for (const r of records)
    for (const f of r.flags)
      if (['localization_missing', 'type_mismatch', 'prompt_injection_suspected', 'model_output_invalid'].includes(f) && !once.has(`${f}:${r.questionId}`)) {
        once.add(`${f}:${r.questionId}`);
        out.push({
          kind: f,
          severity: f === 'prompt_injection_suspected' ? 'medium' : f === 'localization_missing' ? 'low' : 'info',
          questionId: r.questionId,
          detail: f === 'localization_missing' ? `Shown in ${r.language}` : r.questionId,
        });
      }
  if (expectedLoiMinutes && seconds < expectedLoiMinutes * 60 * 0.3)
    out.push({
      kind: 'fast_vs_expected',
      severity: 'info',
      detail: `${seconds} s against an expected ${expectedLoiMinutes} min`,
    });
  return out;
}

export function assertionsFor(
  sc: ScenarioView,
  outcome: SyntheticOutcome,
  seconds: number,
  records: QuestionRecord[],
  redirect: RunResult['redirect'],
  findings: Finding[],
): RunResult['validations'] {
  const v: RunResult['validations'] = [];
  const expected =
    sc.assertions.expectOutcome ??
    (sc.objective === 'complete_path' ? 'complete' : sc.objective === 'terminate_path' ? 'terminate' : undefined);
  if (expected) v.push({ assertion: 'outcome', passed: outcome === expected, expected, actual: outcome });
  if (redirect)
    v.push({ assertion: 'redirect_host_allowed', passed: redirect.allowed, expected: 'allowlisted host', actual: redirect.host });
  if (sc.assertions.maxLoiSeconds)
    v.push({
      assertion: 'loi_within',
      passed: seconds <= sc.assertions.maxLoiSeconds,
      expected: `<= ${sc.assertions.maxLoiSeconds} s`,
      actual: `${seconds} s`,
    });
  const shown = new Set(records.map((r) => r.questionId));
  for (const q of sc.assertions.requiredQuestions ?? [])
    v.push({ assertion: `question_shown:${q}`, passed: shown.has(q), expected: 'shown', actual: shown.has(q) ? 'shown' : 'not shown' });
  const gaps = findings.filter((f) => f.kind === 'validation_missing').length;
  v.push({ assertion: 'survey_validation', passed: gaps === 0, expected: 'no out-of-range answer accepted', actual: `${gaps} accepted` });
  return v;
}
