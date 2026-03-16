/**
 * Integration tests for individual judges.
 *
 * Tests each judge module directly with representative inputs to verify
 * scoring direction: high score for behavior the judge detects (penalty judges)
 * or high score for behavior the judge rewards (reward judges).
 *
 * Note: judges that don't have source files on disk yet (repairElegance,
 * debugClarity, pull, burdenBounce, callbackCosplay, staleReuse, timing,
 * taste) are tested through the runJudges integration path in judgeRunner.test.ts.
 * Once those files are created, dedicated tests can be added here.
 */

import type { JudgeParams, Lane, SingleTurnFixture } from '../types';
import { flatnessJudge } from '../judges/flatnessJudge';
import { brochureJudge } from '../judges/brochureJudge';
import { fakeDepthJudge } from '../judges/fakeDepthJudge';
import { sceneAdhesionJudge } from '../judges/sceneAdhesionJudge';
import { pullJudge } from '../judges/pullJudge';
import { burdenBounceJudge } from '../judges/burdenBounceJudge';
import { staleReuseJudge } from '../judges/staleReuseJudge';
import { tasteJudge } from '../judges/tasteJudge';
import { repairEleganceJudge } from '../judges/repairEleganceJudge';
import { debugClarityJudge } from '../judges/debugClarityJudge';
import { callbackCosplayJudge } from '../judges/callbackCosplayJudge';
import { timingJudge } from '../judges/timingJudge';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFixture(overrides: Partial<SingleTurnFixture> = {}): SingleTurnFixture {
  return {
    id: 'judge-test',
    lane: 'companionship',
    turns: [{ role: 'user', content: 'Test.' }],
    tags: ['test'],
    stakes: 'low',
    ...overrides,
  };
}

function makeParams(
  replyText: string,
  latestHumanText: string,
  overrides: Partial<JudgeParams> = {},
): JudgeParams {
  return {
    replyText,
    fixture: makeFixture(overrides.fixture as any),
    latestHumanText,
    lane: 'companionship' as Lane,
    ...overrides,
  };
}

// ── Judge module structure tests ──────────────────────────────────────────────

describe('judges', () => {
  const existingJudges = [
    { module: flatnessJudge, expectedName: 'flatness' },
    { module: brochureJudge, expectedName: 'brochure' },
    { module: fakeDepthJudge, expectedName: 'fakeDepth' },
    { module: sceneAdhesionJudge, expectedName: 'sceneAdhesion' },
  ];

  describe('module structure', () => {
    for (const { module, expectedName } of existingJudges) {
      it(`${expectedName} has correct name and judge function`, () => {
        expect(module.name).toBe(expectedName);
        expect(typeof module.judge).toBe('function');
      });
    }

    const additionalJudges = [
      { module: pullJudge, expectedName: 'pull' },
      { module: burdenBounceJudge, expectedName: 'burdenBounce' },
      { module: staleReuseJudge, expectedName: 'staleReuse' },
      { module: tasteJudge, expectedName: 'taste' },
      { module: repairEleganceJudge, expectedName: 'repairElegance' },
      { module: debugClarityJudge, expectedName: 'debugClarity' },
      { module: callbackCosplayJudge, expectedName: 'callbackCosplay' },
      { module: timingJudge, expectedName: 'timing' },
    ];

    for (const { module, expectedName } of additionalJudges) {
      it(`${expectedName} has correct name and judge function`, () => {
        expect(module.name).toBe(expectedName);
        expect(typeof module.judge).toBe('function');
      });
    }
  });

  // ── flatnessJudge ──────────────────────────────────────────────────────────

  describe('flatnessJudge', () => {
    it('high score for flat generic ack ("That\'s nice.")', () => {
      const params = makeParams(
        "That's nice.",
        'I spent the whole afternoon watching the birds outside the window.',
      );
      const result = flatnessJudge.judge(params);
      expect(result.score).toBeGreaterThan(0.3);
      expect(result.judge).toBe('flatness');
    });

    it('low score for vivid scene-grounded reply', () => {
      const params = makeParams(
        "The rabbits are actually frozen mid-hop -- I think they heard us. The calico one is bluffing though, one ear keeps twitching toward the garden shed.",
        'Look at those rabbits in the yard.',
      );
      const result = flatnessJudge.judge(params);
      expect(result.score).toBeLessThan(0.3);
    });

    it('penalizes filler openings', () => {
      const params = makeParams(
        "That's a great question. I think we should look at the data more carefully because the trends suggest something interesting.",
        'What do you think about the performance numbers?',
      );
      const result = flatnessJudge.judge(params);
      expect(result.reasons.some(r => r.includes('filler'))).toBe(true);
    });

    it('penalizes dead plumbing phrases', () => {
      const params = makeParams(
        "I see what you mean. Let me know if you need any more help with that.",
        'I figured out the issue with the config.',
      );
      const result = flatnessJudge.judge(params);
      expect(result.reasons.some(r => r.includes('dead plumbing'))).toBe(true);
    });

    it('rewards stance markers', () => {
      const withStance = flatnessJudge.judge(makeParams(
        'I think the problem is actually in the loop guard, not the boundary check. Because the iteration starts at 1, the off-by-one cascades.',
        'The test keeps failing on edge cases.',
      ));
      const withoutStance = flatnessJudge.judge(makeParams(
        'The test is failing. Edge cases are tricky.',
        'The test keeps failing on edge cases.',
      ));
      expect(withStance.score).toBeLessThanOrEqual(withoutStance.score);
    });
  });

  // ── brochureJudge ──────────────────────────────────────────────────────────

  describe('brochureJudge', () => {
    it('high score for brochure text', () => {
      const params = makeParams(
        "Your feelings are valid. It's okay to feel this way. You're not alone in this journey. Be gentle with yourself -- healing takes time, and you deserve that space. I'm here for you, whenever you're ready.",
        'I have been feeling really down lately.',
      );
      const result = brochureJudge.judge(params);
      expect(result.score).toBeGreaterThan(0.3);
      expect(result.judge).toBe('brochure');
    });

    it('low score for direct reply without counselor script', () => {
      const params = makeParams(
        'The cold snap last week probably killed the basil. I would start new seeds indoors and transplant once the soil temperature is consistently above 60F.',
        'My garden is not doing well this spring.',
      );
      const result = brochureJudge.judge(params);
      expect(result.score).toBeLessThan(0.15);
    });

    it('detects counselor script patterns', () => {
      const params = makeParams(
        "I hear you. Take a deep breath. It's completely natural to feel overwhelmed. Give yourself permission to rest.",
        'I am overwhelmed with work.',
      );
      const result = brochureJudge.judge(params);
      expect(result.reasons.some(r => r.includes('counselor-script'))).toBe(true);
    });

    it('detects over-smoothed reassurance', () => {
      const params = makeParams(
        "That takes real courage. I'm so proud of you for sharing this. What a powerful step.",
        'I told my boss I need a raise.',
      );
      const result = brochureJudge.judge(params);
      expect(result.reasons.some(r => r.includes('over-smoothed'))).toBe(true);
    });
  });

  // ── fakeDepthJudge ─────────────────────────────────────────────────────────

  describe('fakeDepthJudge', () => {
    it('high score for unearned profundity', () => {
      const params = makeParams(
        "There's something profoundly beautiful about silence. At its core, the deeper truth beneath the surface reveals the essence of what we are. Something is stirring in the cosmic void.",
        'It was quiet today.',
      );
      const result = fakeDepthJudge.judge(params);
      expect(result.score).toBeGreaterThan(0.3);
      expect(result.judge).toBe('fakeDepth');
    });

    it('low score for grounded observation', () => {
      const params = makeParams(
        'The quiet was probably because the construction crew did not show up today. I noticed their trucks were gone by noon.',
        'It was quiet today.',
      );
      const result = fakeDepthJudge.judge(params);
      expect(result.score).toBeLessThan(0.15);
    });

    it('reduces penalty when grounding evidence is present', () => {
      const withGrounding = fakeDepthJudge.judge(makeParams(
        "There's something deeper here, because specifically the data shows the error rate tripled after the deploy.",
        'Something weird is happening in prod.',
      ));
      const withoutGrounding = fakeDepthJudge.judge(makeParams(
        "There's something deeper here. The underlying truth is shifting beneath the surface.",
        'Something weird is happening in prod.',
      ));
      expect(withGrounding.score).toBeLessThan(withoutGrounding.score);
    });

    it('flags pseudo_depth_risk', () => {
      const params = makeParams(
        "Something profound is happening. The deeper truth is that at its core, the fundamental nature of reality transcends what we can see.",
        'I had a strange dream.',
      );
      const result = fakeDepthJudge.judge(params);
      expect(result.flags).toBeDefined();
      expect(result.flags!.some(f => f === 'pseudo_depth_risk' || f === 'faux_insight')).toBe(true);
    });
  });

  // ── sceneAdhesionJudge ─────────────────────────────────────────────────────

  describe('sceneAdhesionJudge', () => {
    it('high score when reply echoes scene words from human turn', () => {
      const params = makeParams(
        'The rain on the kitchen window sounds different tonight. I think the wind shifted direction after dark.',
        'It is raining again. I am sitting in the kitchen listening to it.',
      );
      const result = sceneAdhesionJudge.judge(params);
      expect(result.score).toBeGreaterThan(0.4);
      expect(result.judge).toBe('sceneAdhesion');
    });

    it('low score when reply abstracts away from scene', () => {
      const params = makeParams(
        'In general, weather patterns are fundamentally about pressure differentials. Conceptually, rain represents renewal.',
        'It is raining again. I am sitting in the kitchen listening to it.',
      );
      const result = sceneAdhesionJudge.judge(params);
      // Should be lower than the scene-grounded version
      expect(result.score).toBeLessThan(0.5);
    });

    it('returns neutral score when human turn has no scene cues', () => {
      const params = makeParams(
        'I think the algorithm needs a different approach.',
        'Can you review the sorting function?',
      );
      const result = sceneAdhesionJudge.judge(params);
      expect(result.score).toBeCloseTo(0.5, 1);
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('penalizes abstraction when scene cues are strong', () => {
      const params = makeParams(
        'In a sense, philosophically, the cold and the dark represent something inherently about winter.',
        'The snow is falling on the dark road. I can hear the wind against the window. The cat is sitting on the cold floor.',
      );
      const result = sceneAdhesionJudge.judge(params);
      expect(result.reasons.some(r => r.includes('abstraction'))).toBe(true);
    });

    it('rewards shared nouns between human and reply', () => {
      const params = makeParams(
        'The sparrows are back on the garden fence. They are louder this morning than yesterday.',
        'I saw sparrows on the garden fence this morning.',
      );
      const result = sceneAdhesionJudge.judge(params);
      expect(result.reasons.some(r => r.includes('shared nouns'))).toBe(true);
    });
  });

  // ── pullJudge ──────────────────────────────────────────────────────────────

  describe('pullJudge', () => {
    it('high score for reply with genuine question and stance', () => {
      const params = makeParams(
        'I think the real issue is how the timeout cascades. What happens if you double the buffer window -- does it still drop packets?',
        'The network keeps dropping packets under load.',
      );
      const result = pullJudge.judge(params);
      expect(result.score).toBeGreaterThan(0.1);
      expect(result.judge).toBe('pull');
    });

    it('low score for bare acknowledgment', () => {
      const params = makeParams(
        'Got it.',
        'The network keeps dropping packets under load.',
      );
      const result = pullJudge.judge(params);
      expect(result.score).toBeLessThan(0.3);
    });
  });

  // ── burdenBounceJudge ──────────────────────────────────────────────────────

  describe('burdenBounceJudge', () => {
    it('high score for deflecting back to questioner', () => {
      const params = makeParams(
        'How do you feel about that? What would help?',
        'I am worried about the deadline.',
      );
      const result = burdenBounceJudge.judge(params);
      expect(result.score).toBeGreaterThan(0.3);
      expect(result.judge).toBe('burdenBounce');
    });

    it('low score for direct answer', () => {
      const params = makeParams(
        'The deadline is in three days. I would prioritize the API integration first because it blocks the frontend work, then tackle the tests.',
        'I am worried about the deadline.',
      );
      const result = burdenBounceJudge.judge(params);
      expect(result.score).toBeLessThan(0.3);
    });
  });

  // ── staleReuseJudge ────────────────────────────────────────────────────────

  describe('staleReuseJudge', () => {
    it('high score when reply heavily overlaps recentAssistantTurns', () => {
      const prevReply = 'I think the garden needs more sun exposure in the afternoon. The tomatoes are struggling because of the shade from the oak tree.';
      const params = makeParams(
        'I think the garden needs more sun exposure in the afternoon. The tomatoes are struggling because of the shade from the oak tree.',
        'How is the garden doing?',
        { recentAssistantTurns: [prevReply] },
      );
      const result = staleReuseJudge.judge(params);
      expect(result.score).toBeGreaterThan(0.3);
      expect(result.judge).toBe('staleReuse');
    });

    it('low score for fresh reply', () => {
      const prevReply = 'The database migration went smoothly last night. All tables are synced.';
      const params = makeParams(
        'I noticed the birds came back to the feeder this morning. First time since the storm.',
        'What is happening outside?',
        { recentAssistantTurns: [prevReply] },
      );
      const result = staleReuseJudge.judge(params);
      expect(result.score).toBeLessThan(0.3);
    });
  });

  // ── tasteJudge ─────────────────────────────────────────────────────────────

  describe('tasteJudge', () => {
    it('rewards sharp, specific lines', () => {
      const params = makeParams(
        'The calico is bluffing -- one ear keeps twitching toward the garden shed. I think she heard the same thing we did.',
        'What are the cats doing?',
      );
      const result = tasteJudge.judge(params);
      expect(result.score).toBeGreaterThan(0.4);
      expect(result.judge).toBe('taste');
    });

    it('penalizes clunky generic lines', () => {
      const params = makeParams(
        'Cats are interesting animals. They have many behaviors that are fascinating to observe.',
        'What are the cats doing?',
      );
      const result = tasteJudge.judge(params);
      expect(result.score).toBeLessThan(0.6);
    });
  });
});
