'use client';
import type { LANGUAGE_LABELS, OBJECTIVE_LABELS, TIMING_LABELS } from '@si/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface AuthView {
  id: string;
  state: string;
  surveyOwner: string;
  ownerContact: string;
  evidenceRef: string;
  purpose: string;
  environments: string[];
  allowedHosts: string[];
  maxSessions: number;
  sessionsUsed: number;
  windows: { days: number[]; start: string; end: string }[];
  timezone: string;
  startsAt: string;
  expiresAt: string;
  exportQuestionContent: boolean;
  requestedBy: string;
  requestedByEmail: string;
  decidedByEmail: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const windowText = (w: AuthView['windows'][number]) =>
  `${w.days.length === 7 ? 'Every day' : w.days.map((d) => DAYS[d]).join(', ')} ${w.start} to ${w.end}`;

export interface Profile {
  id: string;
  code: string;
  label: string;
  age: number;
  gender: string;
  country: string;
  language: string;
  attributes: Record<string, unknown>;
  builtin: boolean;
}
export interface Scenario {
  id: string;
  projectId: string;
  name: string;
  profileId: string;
  profileCode: string;
  profileLabel: string;
  objective: keyof typeof OBJECTIVE_LABELS;
  language: keyof typeof LANGUAGE_LABELS;
  timing: keyof typeof TIMING_LABELS;
  answerStrategy: 'rules' | 'model';
  assertions: { expectOutcome?: string; maxLoiSeconds?: number; requiredQuestions?: string[] };
  overrides: Record<string, unknown>;
}
interface Fixture {
  url: string;
  title: string;
}

export function useFixtures() {
  const g = useQuery({ queryKey: ['qa', 'surveys', 'gate'], queryFn: () => api<{ fixtures: Fixture[] }>('/qa/surveys?stage=gate') });
  const c = useQuery({ queryKey: ['qa', 'surveys', 'client'], queryFn: () => api<{ fixtures: Fixture[] }>('/qa/surveys?stage=client') });
  return { gate: g.data?.fixtures ?? [], client: c.data?.fixtures ?? [] };
}


export interface Job {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  authorizationId: string;
  status: string;
  scenarioIds: string[];
  sessionsPerScenario: number;
  totalSessions: number;
  doneSessions: number;
  intervalSeconds: number;
  scheduledAt: string;
  nextRunAt: string;
  stopReason: string | null;
  waitingFor: string | null;
  createdByEmail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}
export function useJobs(projectId?: string) {
  return useQuery({
    queryKey: ['qa', 'jobs', projectId ?? ''],
    queryFn: () => api<Job[]>(`/qa/jobs${projectId ? `?projectId=${projectId}` : ''}`),
    refetchInterval: 5000,
  });
}

export interface SessionRow {
  id: string;
  projectId: string;
  projectCode: string;
  jobId: string;
  scenarioId: string;
  scenarioName: string;
  profileCode: string;
  seq: number;
  classification: string;
  environment: string;
  language: string;
  outcome: string;
  stopReason: string | null;
  lastStage: string;
  loiSeconds: number;
  clock: string;
  questionCount: number;
  assertionsPassed: number;
  assertionsFailed: number;
  qualityScore: number;
  reviewStatus: string;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  startedAt: string;
  endedAt: string;
}

export interface Stats {
  projectId: string;
  code: string;
  name: string;
  sessions: number;
  outcomes: Record<string, number>;
  syntheticIrPercent: number | null;
  expectedIrPercent: number | null;
  loi: { clock: string; n: number; p25: number | null; median: number | null; p75: number | null; histogram: { from: number; n: number }[]; bucketSeconds: number };
  expectedLoiMinutes: number | null;
  assertions: { passed: number; failed: number; passRate: number | null };
  averageQuality: number | null;
  openReviews: number;
}
export function useStats(projectId?: string) {
  return useQuery({ queryKey: ['qa', 'stats', projectId ?? ''], queryFn: () => api<Stats[]>(`/qa/stats${projectId ? `?projectId=${projectId}` : ''}`) });
}
