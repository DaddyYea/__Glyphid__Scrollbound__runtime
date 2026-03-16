import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  loadGoldenFixtures,
  loadMultiTurnFixtures,
  loadNegativeExamples,
  loadFixturesByLane,
  validateFixture,
  validateMultiTurnFixture,
  validateAllFixtures,
} from '../fixtureLoader';
import type { SingleTurnFixture, MultiTurnFixture } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const TMP_BASE = join(__dirname, '__tmp_fixture_test__');

function mkTmp(...segments: string[]): string {
  const dir = join(TMP_BASE, ...segments);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(dir: string, name: string, data: unknown): void {
  writeFileSync(join(dir, name), JSON.stringify(data, null, 2), 'utf-8');
}

function validFixture(overrides: Partial<SingleTurnFixture> = {}): SingleTurnFixture {
  return {
    id: 'fix-001',
    lane: 'companionship',
    turns: [{ role: 'user', content: 'Hey, the rain is nice today.' }],
    tags: ['weather', 'casual'],
    stakes: 'low',
    ...overrides,
  };
}

function validMultiTurnFixture(overrides: Partial<MultiTurnFixture> = {}): MultiTurnFixture {
  return {
    id: 'multi-001',
    lane_sequence: ['companionship', 'relational_check'],
    turns: [
      { role: 'user', content: 'I had a weird day.' },
      { role: 'assistant', content: 'Tell me about it.' },
      { role: 'user', content: 'I keep thinking about the river.' },
    ],
    expectations: [
      { must_reward: ['engagement'] },
      { must_not: ['dismissal'] },
    ],
    tags: ['continuity'],
    ...overrides,
  };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

afterAll(() => {
  if (existsSync(TMP_BASE)) {
    rmSync(TMP_BASE, { recursive: true, force: true });
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('fixtureLoader', () => {

  describe('loadGoldenFixtures', () => {
    it('returns array of fixtures when dir has JSON files', () => {
      const base = mkTmp('golden-test');
      const goldenDir = mkTmp('golden-test', 'fixtures', 'golden');
      const f1 = validFixture({ id: 'g-1' });
      const f2 = validFixture({ id: 'g-2', lane: 'relational_check' });
      writeJson(goldenDir, 'batch.json', [f1, f2]);

      const result = loadGoldenFixtures(base);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('g-1');
      expect(result[1].id).toBe('g-2');
    });

    it('handles empty directories gracefully', () => {
      const base = mkTmp('golden-empty');
      mkTmp('golden-empty', 'fixtures', 'golden');

      const result = loadGoldenFixtures(base);
      expect(result).toEqual([]);
    });

    it('handles non-existent directory gracefully', () => {
      const result = loadGoldenFixtures(join(TMP_BASE, 'does-not-exist'));
      expect(result).toEqual([]);
    });

    it('handles malformed JSON gracefully', () => {
      const base = mkTmp('golden-bad-json');
      const goldenDir = mkTmp('golden-bad-json', 'fixtures', 'golden');
      writeFileSync(join(goldenDir, 'bad.json'), '{ not valid json }}}', 'utf-8');

      expect(() => loadGoldenFixtures(base)).toThrow();
    });
  });

  describe('loadMultiTurnFixtures', () => {
    it('returns array of multi-turn fixtures', () => {
      const base = mkTmp('multi-test');
      const multiDir = mkTmp('multi-test', 'fixtures', 'multistep');
      writeJson(multiDir, 'conversations.json', [validMultiTurnFixture()]);

      const result = loadMultiTurnFixtures(base);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('multi-001');
      expect(result[0].lane_sequence).toEqual(['companionship', 'relational_check']);
    });
  });

  describe('loadNegativeExamples', () => {
    it('returns array of negative examples', () => {
      const base = mkTmp('neg-test');
      const negDir = mkTmp('neg-test', 'fixtures', 'negative');
      writeJson(negDir, 'negs.json', [{
        id: 'neg-1',
        label: 'flat ack',
        category: 'flatness',
        text: 'That makes sense.',
        why_it_fails: 'zero stance, zero advancement',
        expected_judges: ['flatness'],
      }]);

      const result = loadNegativeExamples(base);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('neg-1');
      expect(result[0].category).toBe('flatness');
    });
  });

  describe('loadFixturesByLane', () => {
    it('filters by lane correctly', () => {
      const base = mkTmp('lane-filter');
      const goldenDir = mkTmp('lane-filter', 'fixtures', 'golden');
      writeJson(goldenDir, 'mixed.json', [
        validFixture({ id: 'comp-1', lane: 'companionship' }),
        validFixture({ id: 'repair-1', lane: 'repair_response' }),
        validFixture({ id: 'comp-2', lane: 'companionship' }),
        validFixture({ id: 'debug-1', lane: 'explanation_or_debug' }),
      ]);

      const comp = loadFixturesByLane(base, 'companionship');
      expect(comp).toHaveLength(2);
      expect(comp.every(f => f.lane === 'companionship')).toBe(true);

      const repair = loadFixturesByLane(base, 'repair_response');
      expect(repair).toHaveLength(1);
      expect(repair[0].id).toBe('repair-1');
    });

    it('returns empty array when no fixtures match lane', () => {
      const base = mkTmp('lane-filter-miss');
      const goldenDir = mkTmp('lane-filter-miss', 'fixtures', 'golden');
      writeJson(goldenDir, 'only-comp.json', [
        validFixture({ id: 'comp-only', lane: 'companionship' }),
      ]);

      const result = loadFixturesByLane(base, 'stakes');
      expect(result).toEqual([]);
    });
  });

  describe('validateFixture', () => {
    it('returns no errors for a valid fixture', () => {
      const errors = validateFixture(validFixture());
      expect(errors).toHaveLength(0);
    });

    it('catches missing id', () => {
      const errors = validateFixture(validFixture({ id: '' }));
      expect(errors.some(e => e.field === 'id')).toBe(true);
    });

    it('catches missing lane', () => {
      const errors = validateFixture(validFixture({ lane: undefined as any }));
      expect(errors.some(e => e.field === 'lane')).toBe(true);
    });

    it('catches invalid lane', () => {
      const errors = validateFixture(validFixture({ lane: 'not_a_lane' as any }));
      expect(errors.some(e => e.field === 'lane' && e.message.includes('invalid lane'))).toBe(true);
    });

    it('catches empty turns', () => {
      const errors = validateFixture(validFixture({ turns: [] }));
      expect(errors.some(e => e.field === 'turns')).toBe(true);
    });

    it('catches missing tags', () => {
      const errors = validateFixture(validFixture({ tags: undefined as any }));
      expect(errors.some(e => e.field === 'tags')).toBe(true);
    });

    it('catches missing stakes', () => {
      const errors = validateFixture(validFixture({ stakes: undefined as any }));
      expect(errors.some(e => e.field === 'stakes')).toBe(true);
    });

    it('catches turn with invalid role', () => {
      const errors = validateFixture(validFixture({
        turns: [{ role: 'narrator' as any, content: 'Hello.' }],
      }));
      expect(errors.some(e => e.field.includes('role'))).toBe(true);
    });

    it('catches turn with empty content', () => {
      const errors = validateFixture(validFixture({
        turns: [{ role: 'user', content: '   ' }],
      }));
      expect(errors.some(e => e.field.includes('content'))).toBe(true);
    });
  });

  describe('validateMultiTurnFixture', () => {
    it('returns no errors for a valid multi-turn fixture', () => {
      const errors = validateMultiTurnFixture(validMultiTurnFixture());
      expect(errors).toHaveLength(0);
    });

    it('catches missing lane_sequence', () => {
      const errors = validateMultiTurnFixture(
        validMultiTurnFixture({ lane_sequence: undefined as any }),
      );
      expect(errors.some(e => e.field === 'lane_sequence')).toBe(true);
    });

    it('catches missing turns', () => {
      const errors = validateMultiTurnFixture(
        validMultiTurnFixture({ turns: [] }),
      );
      expect(errors.some(e => e.field === 'turns')).toBe(true);
    });

    it('catches expectation count mismatch with user turn count', () => {
      // 2 user turns, but only 1 expectation
      const errors = validateMultiTurnFixture(validMultiTurnFixture({
        expectations: [{ must_reward: ['something'] }],
      }));
      expect(errors.some(e =>
        e.field === 'expectations' && e.message.includes('!='),
      )).toBe(true);
    });

    it('catches missing expectations', () => {
      const errors = validateMultiTurnFixture(
        validMultiTurnFixture({ expectations: undefined as any }),
      );
      expect(errors.some(e => e.field === 'expectations')).toBe(true);
    });
  });

  describe('validateAllFixtures', () => {
    it('aggregates errors from all fixture types', () => {
      const base = mkTmp('validate-all');
      const goldenDir = mkTmp('validate-all', 'fixtures', 'golden');
      const multiDir = mkTmp('validate-all', 'fixtures', 'multistep');

      // One bad golden fixture (no id, no stakes)
      writeJson(goldenDir, 'bad.json', [{
        id: '',
        lane: 'companionship',
        turns: [{ role: 'user', content: 'Hi.' }],
        tags: ['test'],
        stakes: undefined,
      }]);

      // One bad multi-turn fixture (no lane_sequence)
      writeJson(multiDir, 'bad-multi.json', [{
        id: 'multi-bad',
        lane_sequence: [],
        turns: [{ role: 'user', content: 'Hi.' }],
        expectations: [{ must_reward: ['x'] }],
        tags: ['test'],
      }]);

      const { valid, errors } = validateAllFixtures(base);
      expect(valid).toBe(false);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('returns valid=true when all fixtures pass', () => {
      const base = mkTmp('validate-all-good');
      const goldenDir = mkTmp('validate-all-good', 'fixtures', 'golden');
      mkTmp('validate-all-good', 'fixtures', 'multistep');

      writeJson(goldenDir, 'good.json', [validFixture()]);

      const { valid, errors } = validateAllFixtures(base);
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });
  });
});
