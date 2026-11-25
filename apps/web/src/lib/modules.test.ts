import { describe, expect, it } from 'vitest';
import { MODULES } from './modules.js';

describe('module registry', () => {
  it('covers all 19 SampIntel AI modules', () => {
    const numbered = new Set(MODULES.filter((m) => m.n > 0).map((m) => m.n));
    expect([...numbered].sort((a, b) => a - b)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
  });
  it('gives every page its own route', () => expect(new Set(MODULES.map((m) => m.href)).size).toBe(MODULES.length));
});
