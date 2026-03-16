import { DoctrineRenderer } from '../DoctrineRenderer';
import { LanguageLobeBackend, LanguageLobeLoop } from '../LanguageLobeLoop';
import { RouterLanguagePulseLoop } from '../RouterLanguagePulseLoop';
import { createRouterPacket } from '../RouterPacket';
import { RouterTargetSpec } from '../DoctrineTurnSchema';
import { createEmptyPacket, ThoughtPulsePacket } from '../../types/ThoughtPulsePacket';

class FakeLanguageBackend implements LanguageLobeBackend {
  async generate(request: { systemPrompt: string; latestHumanText: string; modelName: string; params: any; }) {
    return {
      content: 'ok',
      tokensGenerated: 1,
      finishReason: 'stop' as const,
      processingTimeMs: 1,
      modelName: request.modelName,
    };
  }
}

function makeTargetSpec(overrides: Partial<RouterTargetSpec> = {}): RouterTargetSpec {
  return {
    rawUserTurn: 'long raw user turn blob with many side comments and mixed intent',
    mustAnswer: 'help inspect the schema',
    liveTopic: 'schema inspection',
    userGoal: 'get implementation help',
    questionForm: 'none',
    mixedIntent: true,
    primaryIntent: 'task',
    secondaryIntent: 'companionship',
    arbitrationReason: 'task outranked side commentary due to explicit imperative request',
    confidence: 0.78,
    ...overrides,
  };
}

function makeRouterPacket(overrides: any = {}) {
  const targetSpec = makeTargetSpec(overrides.targetSpec || {});
  return createRouterPacket({
    turnType: 'task',
    target: targetSpec.mustAnswer,
    targetSpec,
    doctrineModes: ['truthfulness', 'answer_first', 'continuity_required'],
    tone: 'neutral',
    length: 'medium',
    askAllowed: true,
    answerFirst: true,
    continuityRequired: true,
    dangerFlags: ['stale_topic'],
    continuity: {
      keepThread: true,
      threadLabel: 'thread:schema',
      priorTopic: 'schema adequacy',
      supersedesPriorThread: false,
      supersedingReason: 'none',
      ...(overrides.continuity || {}),
    },
    routerModel: 'phi3',
    ...(overrides.packet || {}),
  });
}

function makeThoughtPacket(overrides: Partial<ThoughtPulsePacket> = {}): ThoughtPulsePacket {
  const packet = createEmptyPacket('outer');
  return {
    ...packet,
    intentSeed: 'weather walk squirrel',
    openSlots: ['weather', 'squirrel', 'walking'],
    reflectionFlags: [],
    speechOutput: 'weather squirrel walking',
    ...overrides,
  };
}

async function makeLoop() {
  const doctrine = new DoctrineRenderer({
    truthfulness: 'Tell the truth.',
    answer_first: 'Answer first.',
    continuity_required: 'Stay with the live thread.',
  });
  const language = new LanguageLobeLoop(new FakeLanguageBackend(), doctrine);
  return new RouterLanguagePulseLoop(language, doctrine);
}

describe('RouterLanguagePulseLoop', () => {
  it('openSlots use mustAnswer and liveTopic, not raw turn blob', async () => {
    const loop = await makeLoop();
    const packet = makeRouterPacket({
      targetSpec: {
        rawUserTurn: 'this whole thing is weird, just walking, but when i get back help me inspect the schema because the extraction and drift and whatever are off',
        mustAnswer: 'help inspect the schema',
        liveTopic: 'schema inspection',
        repairObject: 'stale topic drift',
      },
    });

    const result = await loop.generate({
      routerPacket: packet,
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'help inspect the schema',
      modelName: 'test-model',
    });

    expect(result.routerDebug.openSlots).toContain('help inspect the schema');
    expect(result.routerDebug.openSlots).toContain('schema inspection');
    expect(result.routerDebug.openSlots.join(' ')).not.toContain('this whole thing is weird');
    expect(result.prompt.systemPrompt).toContain('must_answer: help inspect the schema');
    expect(result.prompt.systemPrompt).toContain('live_topic: schema inspection');
    expect(result.prompt.systemPrompt).toContain('repair_object: stale topic drift');
    expect(result.prompt.systemPrompt).toContain('question_form: none');
    expect(result.prompt.systemPrompt).toContain('mixed_intent: yes');
  });

  it('stale previous thoughts pruned when overlap is low', async () => {
    const loop = await makeLoop();
    (loop as any).state.previousThoughts = [
      makeThoughtPacket({ intentSeed: 'weather', openSlots: ['weather'], speechOutput: 'weather report' }),
      makeThoughtPacket({ intentSeed: 'squirrel', openSlots: ['squirrel'], speechOutput: 'squirrel update' }),
      makeThoughtPacket({ intentSeed: 'walking', openSlots: ['walking'], speechOutput: 'walking thoughts' }),
    ];

    const result = await loop.generate({
      routerPacket: makeRouterPacket({
        packet: { turnType: 'repair' },
        targetSpec: {
          mustAnswer: 'address the miss and answer what was asked',
          liveTopic: 'schema adequacy',
          repairObject: 'stale topic drift',
          primaryIntent: 'repair',
          secondaryIntent: 'question',
          questionForm: 'open',
        },
      }),
      agentName: 'Alois Claude 4.5',
      latestHumanText: "that doesn't answer what I asked",
      modelName: 'test-model',
    });

    expect(result.routerDebug.previousThoughtCountBefore).toBe(3);
    expect(result.routerDebug.previousThoughtCountAfter).toBeLessThan(3);
    expect(result.routerDebug.staleCarryoverPruned).toBe(true);
    expect(result.routerDebug.previousThoughtMaxOverlap).toBeLessThan(0.3);
  });

  it('repair flushes unrelated previous thoughts', async () => {
    const loop = await makeLoop();
    (loop as any).state.previousThoughts = [
      makeThoughtPacket({ intentSeed: 'companionship', openSlots: ['walking', 'together'] }),
      makeThoughtPacket({ intentSeed: 'weather', openSlots: ['weather'] }),
    ];

    const result = await loop.generate({
      routerPacket: makeRouterPacket({
        packet: { turnType: 'repair' },
        targetSpec: {
          mustAnswer: 'address the miss and answer what was asked',
          liveTopic: 'answer failure',
          repairObject: 'failed to answer direct question',
          primaryIntent: 'repair',
          secondaryIntent: 'question',
          questionForm: 'open',
        },
      }),
      agentName: 'Alois Claude 4.5',
      latestHumanText: "that doesn't answer what I asked",
      modelName: 'test-model',
    });

    expect(result.routerDebug.staleCarryoverPruned).toBe(true);
    expect(result.routerDebug.previousThoughtCountAfter).toBeLessThanOrEqual(1);
  });

  it('supersession increases carryover pruning', async () => {
    const loop = await makeLoop();
    (loop as any).state.previousThoughts = [
      makeThoughtPacket({ intentSeed: 'walk', openSlots: ['walking'] }),
      makeThoughtPacket({ intentSeed: 'squirrel', openSlots: ['squirrel'] }),
      makeThoughtPacket({ intentSeed: 'weather', openSlots: ['weather'] }),
    ];

    const result = await loop.generate({
      routerPacket: makeRouterPacket({
        continuity: {
          supersedesPriorThread: true,
          supersedingReason: 'explicit_return',
          priorTopic: 'walking squirrel weather',
          threadLabel: 'thread:walk',
        },
        targetSpec: {
          mustAnswer: 'help inspect the schema',
          liveTopic: 'schema inspection',
          primaryIntent: 'task',
          secondaryIntent: 'none',
          questionForm: 'none',
          mixedIntent: false,
        },
      }),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'okay i\'m back, back to the router',
      modelName: 'test-model',
    });

    expect(result.routerDebug.supersedesPriorThread).toBe(true);
    expect(result.routerDebug.supersedingReason).toBe('explicit_return');
    expect(result.routerDebug.previousThoughtCountAfter).toBeLessThanOrEqual(1);
  });

  it('routerDebug includes carryover pruning stats', async () => {
    const loop = await makeLoop();
    (loop as any).state.previousThoughts = [makeThoughtPacket()];

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'help inspect the schema',
      modelName: 'test-model',
    });

    expect(result.routerDebug).toEqual(expect.objectContaining({
      previousThoughtCountBefore: expect.any(Number),
      previousThoughtCountAfter: expect.any(Number),
      previousThoughtMaxOverlap: expect.any(Number),
      previousThoughtMinOverlap: expect.any(Number),
      staleCarryoverPruned: expect.any(Boolean),
    }));
  });
});
