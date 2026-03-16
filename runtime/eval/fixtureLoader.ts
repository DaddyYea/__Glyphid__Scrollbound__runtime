// runtime/eval/fixtureLoader.ts
// Loads and validates fixture files from disk

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { SingleTurnFixture, MultiTurnFixture, NegativeExample, Lane } from './types';

const VALID_LANES: Lane[] = [
  'companionship', 'relational_check', 'relational_answer',
  'repair_response', 'explanation_or_debug', 'task_or_helper',
  'low_payload', 'stakes',
];

function loadJsonDir<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  const results: T[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && extname(entry.name) === '.json') {
      const raw = readFileSync(join(dir, entry.name), 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      } else {
        results.push(parsed);
      }
    } else if (entry.isDirectory()) {
      results.push(...loadJsonDir<T>(join(dir, entry.name)));
    }
  }
  return results;
}

export function loadGoldenFixtures(baseDir: string): SingleTurnFixture[] {
  const goldenDir = join(baseDir, 'fixtures', 'golden');
  return loadJsonDir<SingleTurnFixture>(goldenDir);
}

export function loadMultiTurnFixtures(baseDir: string): MultiTurnFixture[] {
  const multiDir = join(baseDir, 'fixtures', 'multistep');
  return loadJsonDir<MultiTurnFixture>(multiDir);
}

export function loadNegativeExamples(baseDir: string): NegativeExample[] {
  const negDir = join(baseDir, 'fixtures', 'negative');
  return loadJsonDir<NegativeExample>(negDir);
}

export function loadFixturesByLane(baseDir: string, lane: Lane): SingleTurnFixture[] {
  return loadGoldenFixtures(baseDir).filter(f => f.lane === lane);
}

export function loadFixturesBySuite(baseDir: string, suite: string): SingleTurnFixture[] | MultiTurnFixture[] | NegativeExample[] {
  switch (suite) {
    case 'golden': return loadGoldenFixtures(baseDir);
    case 'multistep': return loadMultiTurnFixtures(baseDir);
    case 'negative': return loadNegativeExamples(baseDir) as any;
    default: throw new Error(`Unknown suite: ${suite}`);
  }
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface ValidationError {
  fixtureId: string;
  field: string;
  message: string;
}

export function validateFixture(fixture: SingleTurnFixture): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = fixture.id || '(no id)';

  if (!fixture.id) errors.push({ fixtureId: id, field: 'id', message: 'missing id' });
  if (!fixture.lane) errors.push({ fixtureId: id, field: 'lane', message: 'missing lane' });
  else if (!VALID_LANES.includes(fixture.lane)) {
    errors.push({ fixtureId: id, field: 'lane', message: `invalid lane: ${fixture.lane}` });
  }
  if (!fixture.turns || fixture.turns.length === 0) {
    errors.push({ fixtureId: id, field: 'turns', message: 'no turns provided' });
  } else {
    for (let i = 0; i < fixture.turns.length; i++) {
      const t = fixture.turns[i];
      if (!t.role || !['user', 'assistant'].includes(t.role)) {
        errors.push({ fixtureId: id, field: `turns[${i}].role`, message: `invalid role: ${t.role}` });
      }
      if (!t.content || t.content.trim().length === 0) {
        errors.push({ fixtureId: id, field: `turns[${i}].content`, message: 'empty content' });
      }
    }
  }
  if (!fixture.tags || !Array.isArray(fixture.tags)) {
    errors.push({ fixtureId: id, field: 'tags', message: 'missing or invalid tags array' });
  }
  if (!fixture.stakes) {
    errors.push({ fixtureId: id, field: 'stakes', message: 'missing stakes' });
  }

  return errors;
}

export function validateMultiTurnFixture(fixture: MultiTurnFixture): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = fixture.id || '(no id)';

  if (!fixture.id) errors.push({ fixtureId: id, field: 'id', message: 'missing id' });
  if (!fixture.lane_sequence || fixture.lane_sequence.length === 0) {
    errors.push({ fixtureId: id, field: 'lane_sequence', message: 'missing lane_sequence' });
  }
  if (!fixture.turns || fixture.turns.length === 0) {
    errors.push({ fixtureId: id, field: 'turns', message: 'no turns' });
  }
  if (!fixture.expectations || fixture.expectations.length === 0) {
    errors.push({ fixtureId: id, field: 'expectations', message: 'no expectations' });
  }
  const userTurnCount = fixture.turns?.filter(t => t.role === 'user').length || 0;
  if (fixture.expectations && fixture.expectations.length !== userTurnCount) {
    errors.push({
      fixtureId: id, field: 'expectations',
      message: `expectations count (${fixture.expectations.length}) != user turn count (${userTurnCount})`,
    });
  }

  return errors;
}

export function validateAllFixtures(baseDir: string): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  for (const f of loadGoldenFixtures(baseDir)) errors.push(...validateFixture(f));
  for (const f of loadMultiTurnFixtures(baseDir)) errors.push(...validateMultiTurnFixture(f));

  return { valid: errors.length === 0, errors };
}
