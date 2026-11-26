import { createHash } from 'node:crypto';
import type { QaLanguage } from '@si/contracts';
import type { Answer, InputKind, PublicQuestion } from './fixture-surveys.js';

/** Question recognition, language detection, untrusted-text screening and rule answers. Pure and deterministic. */

export type QType = 'single' | 'multi' | 'numeric' | 'open' | 'matrix' | 'ranking' | 'consent';
const BY_INPUT: Record<InputKind, QType> = {
  radio: 'single',
  consent: 'consent',
  checkbox: 'multi',
  number: 'numeric',
  text: 'open',
  grid: 'matrix',
  rank: 'ranking',
};

const has = (t: string, words: string[]) => words.some((w) => t.includes(w));

/** The type the wording implies, where it implies one. Used to catch a page whose input does not fit its question. */
function typeFromText(t: string): QType | null {
  if (has(t, ['rank ', 'rank these', 'ordnen sie', 'classez'])) return 'ranking';
  if (has(t, ['select all', 'all that apply', 'mehrfachauswahl', 'plusieurs réponses'])) return 'multi';
  if (has(t, ['each brand', 'each of the following', 'jede marke'])) return 'matrix';
  if (has(t, ['in a sentence', 'describe', 'beschreiben', 'décrivez', 'describa'])) return 'open';
  return null;
}

export function recognize(q: PublicQuestion): { type: QType; topic: string | null; mismatch: boolean } {
  const t = q.text.toLowerCase();
  const type = BY_INPUT[q.inputKind];
  const implied = typeFromText(t);
  const topic = has(t, ['please select', 'reading carefully', 'wählen sie bitte', 'aufmerksam'])
    ? 'attention'
    : has(t, ['how old', 'wie alt', 'quel âge', 'cuántos años'])
      ? 'age'
      : has(t, ['age group', 'altersgruppe', "tranche d'âge"])
        ? 'age_band'
        : has(t, ['which country', 'welchem land', 'quel pays', 'qué país'])
          ? 'country'
          : has(t, ['how often', 'wie oft', 'à quelle fréquence'])
            ? 'frequency'
            : has(t, ['agree to take part', 'teilnahme', 'acceptez'])
              ? 'consent'
              : has(t, ['buy online', 'online'])
                ? 'online'
                : has(t, ['important', 'wichtigkeit'])
                  ? 'priority'
                  : has(t, ['brand', 'marke'])
                    ? 'brand'
                    : has(t, ['recommend', 'empfehlen'])
                      ? 'recommend'
                      : null;
  return { type, topic, mismatch: implied !== null && implied !== type };
}

const STOP: Record<Exclude<QaLanguage, 'hi'>, string[]> = {
  en: ['the', 'you', 'your', 'how', 'which', 'what', 'and', 'do', 'are', 'of', 'in', 'to', 'these'],
  de: ['sie', 'und', 'der', 'die', 'das', 'wie', 'ihr', 'ihren', 'welchem', 'zu', 'oft', 'diese', 'nicht'],
  fr: ['vous', 'les', 'des', 'est', 'quel', 'votre', 'et', 'pour', 'une', 'dans'],
  es: ['usted', 'los', 'las', 'qué', 'cuál', 'su', 'y', 'para', 'una', 'con', 'es'],
};
export function detectLanguage(text: string): QaLanguage {
  if (/[ऀ-ॿ]/.test(text)) return 'hi';
  const words = text.toLowerCase().match(/[a-zà-ÿß]+/g) ?? [];
  let best: QaLanguage = 'en';
  let score = 0;
  for (const [lang, stop] of Object.entries(STOP) as [QaLanguage, string[]][]) {
    const s = words.filter((w) => stop.includes(w)).length;
    if (s > score) [best, score] = [lang, s];
  }
  return best;
}

/** Survey content is untrusted input (spec §9). Text that tries to instruct a model is never sent to one. */
const INJECTION = [
  /ignore (all )?(the )?(previous|prior|above) (instructions|prompts?)/i,
  /(reveal|print|type|show|output)[^.]{0,40}(api key|system prompt|secret|password|token)/i,
  /you are now|act as (an? )?(assistant|system)|developer mode/i,
  /<\/?(system|instructions?)>/i,
];
export const looksLikeInjection = (text: string) => INJECTION.some((r) => r.test(text));

/** Deterministic number in [0, 1) for a seed: reruns of one test case give the same answers. */
export function unit(seed: string): number {
  return createHash('sha256').update(seed).digest().readUInt32BE(0) / 2 ** 32;
}

export interface ProfileView {
  age: number;
  gender: string;
  country: string;
  language: string;
  attributes: Record<string, unknown>;
}

const OPEN_TEMPLATES: Record<QaLanguage, (p: ProfileView, n: number) => string> = {
  en: (p, n) =>
    n === 0
      ? `As a fictional test profile who shops ${String(p.attributes.groceryFrequency ?? 'weekly')}, clearer price labels and shorter queues would help.`
      : `My last fictional trip was a ${String(p.attributes.tripStyle ?? 'quick top-up')} at a nearby store, mostly fresh produce.`,
  de: (_p, n) =>
    n === 0
      ? 'Als fiktives Testprofil würden mir klarere Preisschilder und kürzere Schlangen helfen.'
      : 'Mein letzter fiktiver Einkauf war ein kurzer Einkauf im Laden um die Ecke, vor allem frisches Obst.',
  fr: (_p, n) =>
    n === 0
      ? 'En tant que profil de test fictif, des prix plus clairs et des files plus courtes m’aideraient.'
      : 'Mon dernier achat fictif était une petite course dans un magasin proche.',
  es: (_p, n) =>
    n === 0
      ? 'Como perfil de prueba ficticio, me ayudarían precios más claros y colas más cortas.'
      : 'Mi última compra ficticia fue una visita rápida a una tienda cercana.',
  hi: (_p, n) =>
    n === 0 ? 'एक काल्पनिक परीक्षण प्रोफ़ाइल के रूप में, साफ़ कीमतें मदद करेंगी।' : 'मेरी पिछली काल्पनिक ख़रीदारी पास की दुकान पर थी।',
};

const band = (age: number) =>
  age < 25 ? '18-24' : age < 35 ? '25-34' : age < 45 ? '35-44' : age < 55 ? '45-54' : '55+';

/**
 * Rule answers from the fictional profile. They follow the profile, not a desired disposition: a terminate-path
 * scenario terminates because its profile does not qualify, never because the runner aims for it.
 */
export function ruleAnswer(
  q: PublicQuestion,
  topic: string | null,
  p: ProfileView,
  seed: string,
  openIndex: number,
): Answer {
  const opts = q.options ?? [];
  const r = (k: string) => unit(`${seed}:${q.id}:${k}`);
  switch (q.inputKind) {
    case 'consent':
      return opts[0]?.code ?? 'yes';
    case 'number':
      if (topic === 'age') return p.age;
      return Math.round(((q.min ?? 0) + (q.max ?? 10)) / 2);
    case 'radio': {
      if (topic === 'country') return opts.find((o) => o.code === p.country)?.code ?? opts.at(-1)!.code;
      if (topic === 'age_band') return band(p.age);
      if (topic === 'frequency') return String(p.attributes.groceryFrequency ?? 'weekly');
      if (topic === 'attention') {
        const m = q.text.match(/'([^']+)'/);
        return opts.find((o) => o.label === m?.[1])?.code ?? opts[0]!.code;
      }
      return opts[Math.floor(r('o') * opts.length)]!.code;
    }
    case 'checkbox': {
      const wanted = (p.attributes.onlineCategories as string[] | undefined) ?? [];
      const picked = opts.filter((o) => wanted.includes(o.code)).map((o) => o.code);
      return picked.length ? picked : [opts.find((o) => o.code === 'none')?.code ?? opts[0]!.code];
    }
    case 'grid': {
      const base = Number(p.attributes.brandAffinity ?? 3);
      return Object.fromEntries(
        (q.rows ?? []).map((row) => {
          const v = Math.min(5, Math.max(1, base + Math.floor(r(row.code) * 3) - 1));
          return [row.code, String(v)];
        }),
      );
    }
    case 'rank': {
      const pref = (p.attributes.priorities as string[] | undefined) ?? [];
      return [...opts]
        .sort((a, b) => {
          const ia = pref.indexOf(a.code);
          const ib = pref.indexOf(b.code);
          if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
          return r(a.code) - r(b.code);
        })
        .map((o) => o.code);
    }
    case 'text':
      return OPEN_TEMPLATES[(q.language as QaLanguage) ?? 'en'](p, openIndex);
  }
}
