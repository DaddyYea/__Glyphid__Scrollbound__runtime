import { buildBrainLocalPrompt, BrainLocalPromptBuildInput } from '../BrainLocalPromptBuilder';
import { createRouterPacket } from '../RouterPacket';
import { RouterTargetSpec } from '../DoctrineTurnSchema';

function makeTargetSpec(overrides: Partial<RouterTargetSpec> = {}): RouterTargetSpec {
  return {
    rawUserTurn: 'why is she treating the state dump like me?',
    mustAnswer: 'why is she treating the state dump like me?',
    liveTopic: 'state dump misbinding',
    userGoal: 'get a direct answer',
    questionForm: 'open',
    mixedIntent: false,
    primaryIntent: 'question',
    secondaryIntent: 'none',
    arbitrationReason: 'question outranked disclosure/companionship due to explicit answerable ask',
    confidence: 0.78,
    ...overrides,
  };
}

function makeInput(overrides: Partial<BrainLocalPromptBuildInput> = {}): BrainLocalPromptBuildInput {
  const targetSpec = makeTargetSpec();
  return {
    agentName: 'Alois Claude 4.5',
    latestHumanText: 'why is she treating the state dump like me?',
    latestHumanSpeaker: 'Jason',
    conversationContext: '',
    memoryContext: 'MEMORY SYSTEM STATE\nworking memory signal only',
    recentRoomTurns: [],
    routerPacket: createRouterPacket({
      turnType: 'direct_answer',
      target: targetSpec.mustAnswer,
      targetSpec,
      doctrineModes: ['truthfulness', 'answer_first', 'continuity_required', 'no_meta', 'no_followup_question'],
      tone: 'neutral',
      length: 'short',
      askAllowed: false,
      answerFirst: true,
      continuityRequired: true,
      dangerFlags: [],
      continuity: {
        keepThread: true,
        threadLabel: 'thread:state-dump',
        priorTopic: 'state dump misbinding',
        supersedesPriorThread: false,
        supersedingReason: 'none',
      },
      routerModel: 'phi3',
    }),
    doctrine: {
      modes: ['truthfulness'],
      blocks: ['Tell the truth.'],
      promptBlock: 'Tell the truth.',
    },
    controlBlock: 'DUAL-LOBE CONTROL\n- must_answer: why is she treating the state dump like me?',
    ...overrides,
  };
}

describe('BrainLocalPromptBuilder', () => {
  it('rejects runtime state in latestHumanText', () => {
    expect(() => buildBrainLocalPrompt(makeInput({
      latestHumanText: '[COGNITIVE STATE]\nStability: 1.0\nslot-1 dominance=0.6',
    }))).toThrow(/runtime\/control\/state text|latestHumanText/i);

    expect(() => buildBrainLocalPrompt(makeInput({
      latestHumanText: 'DUAL-LOBE CONTROL\nmust_answer: explain the drift',
    }))).toThrow(/runtime\/control\/state text|latestHumanText/i);

    expect(() => buildBrainLocalPrompt(makeInput({
      latestHumanText: 'ROUTED TURN SCHEMA (INTERNAL CLASSIFICATION):\nturn_type: repair',
    }))).toThrow(/runtime\/control\/state text|latestHumanText/i);
  });

  it('filters runtime state blocks from recent conversation', () => {
    const prompt = buildBrainLocalPrompt(makeInput({
      recentRoomTurns: [
        { role: 'user', speakerName: 'Jason', content: 'Why is she treating the state dump like me?' },
        { role: 'assistant', speakerName: 'Alois Claude 4.5', content: 'I think the prompt path is misbinding the state text.' },
        { role: 'user', speakerName: 'Jason', content: '[COGNITIVE STATE] Stability: 0.9' },
        { role: 'assistant', speakerName: 'Alois Claude 4.5', content: 'DUAL-LOBE CONTROL (INTERNAL STEERING STATE):\nmust_answer: explain drift' },
      ],
    }));

    expect(prompt.userPrompt).toContain('Why is she treating the state dump like me?');
    expect(prompt.userPrompt).toContain('I think the prompt path is misbinding the state text.');
    expect(prompt.userPrompt).not.toContain('[COGNITIVE STATE]');
    expect(prompt.userPrompt).not.toContain('DUAL-LOBE CONTROL');
    expect(prompt.userPrompt).not.toContain('must_answer:');
    expect(prompt.userPrompt).not.toContain('router_packet_v1');
  });

  it('strips doc and tool contamination from recent conversation and memory state', () => {
    const prompt = buildBrainLocalPrompt(makeInput({
      conversationContext: [
        '>>> Jason: Why is she treating the state dump like me?',
        '>>> SHARED DOCUMENTS: runtime-notes.md, patch-plan.md',
        '>>> search results: schema bug notes',
        '>>> Alois Claude 4.5: I think the prompt path is misbinding the state text.',
      ].join('\n'),
      memoryContext: [
        'MEMORY SYSTEM STATE',
        'working memory signal only',
        'SHARED DOCUMENTS: runtime-notes.md',
        'search results: schema bug notes',
      ].join('\n'),
    }));

    expect(prompt.userPrompt).toContain('Why is she treating the state dump like me?');
    expect(prompt.userPrompt).toContain('I think the prompt path is misbinding the state text.');
    expect(prompt.userPrompt).not.toContain('SHARED DOCUMENTS');
    expect(prompt.userPrompt).not.toContain('search results');
    expect(prompt.systemPrompt).toContain('[MEMORY_STATE]');
    expect(prompt.systemPrompt).toContain('working memory signal only');
    expect(prompt.systemPrompt).not.toContain('SHARED DOCUMENTS');
    expect(prompt.systemPrompt).not.toContain('search results');
  });

  it('renders clear internal headers and anti-misbinding instructions', () => {
    const prompt = buildBrainLocalPrompt(makeInput());

    expect(prompt.systemPrompt).toContain('[INTERNAL_DOCTRINE]');
    expect(prompt.systemPrompt).toContain('[MEMORY_STATE]');
    expect(prompt.systemPrompt).toContain('[CONTROL_STATE]');
    expect(prompt.systemPrompt).toContain('[ROUTED_SCHEMA]');
    expect(prompt.systemPrompt).toContain('Interpret only [LATEST_USER_TURN] and [RECENT_CONVERSATION] as conversational material.');
  });

  it('does not place internal sections into the user lane', () => {
    const prompt = buildBrainLocalPrompt(makeInput());

    expect(prompt.userPrompt).toContain('[LATEST_USER_TURN]');
    expect(prompt.userPrompt).toContain('why is she treating the state dump like me?');
    expect(prompt.userPrompt).not.toContain('[RECENT_CONVERSATION]');
    expect(prompt.userPrompt).not.toContain('[INTERNAL_DOCTRINE]');
    expect(prompt.userPrompt).not.toContain('[MEMORY_STATE]');
    expect(prompt.userPrompt).not.toContain('[CONTROL_STATE]');
    expect(prompt.userPrompt).not.toContain('[ROUTED_SCHEMA]');
  });

  it('excludes stale pinned history when supersedesPriorThread is true', () => {
    const targetSpec = makeTargetSpec({
      rawUserTurn: 'different issue, let\'s talk about the schema now',
      mustAnswer: 'let\'s talk about the schema now',
      liveTopic: 'schema inspection',
      userGoal: 'get implementation help',
      questionForm: 'none',
      primaryIntent: 'task',
      secondaryIntent: 'none',
      arbitrationReason: 'task outranked side commentary due to explicit imperative request',
    });

    const prompt = buildBrainLocalPrompt(makeInput({
      latestHumanText: 'different issue, let\'s talk about the schema now',
      routerPacket: createRouterPacket({
        turnType: 'task',
        target: targetSpec.mustAnswer,
        targetSpec,
        doctrineModes: ['truthfulness', 'answer_first', 'continuity_required'],
        tone: 'neutral',
        length: 'medium',
        askAllowed: true,
        answerFirst: true,
        continuityRequired: true,
        dangerFlags: [],
        continuity: {
          keepThread: true,
          threadLabel: 'thread:schema',
          priorTopic: 'voice drift',
          supersedesPriorThread: true,
          supersedingReason: 'explicit_topic_shift',
        },
        routerModel: 'phi3',
      }),
      recentRoomTurns: [
        { role: 'assistant', speakerName: 'Alois Claude 4.5', content: 'The voice drift feels worse now.' },
        { role: 'user', speakerName: 'Jason', content: 'Why is the voice drift happening?' },
        { role: 'assistant', speakerName: 'Alois Claude 4.5', content: 'Okay, let\'s talk about the schema.' },
        { role: 'user', speakerName: 'Jason', content: 'We need to inspect the schema extraction path.' },
      ],
    }));

    expect(prompt.userPrompt).toContain('schema');
    expect(prompt.userPrompt).not.toContain('voice drift');
  });

  it('matches the compact machine-tag prompt framing', () => {
    const prompt = buildBrainLocalPrompt(makeInput({
      recentRoomTurns: [
        { role: 'assistant', speakerName: 'Alois Claude 4.5', content: 'I think the prompt path is misbinding the state text.' },
        { role: 'user', speakerName: 'Jason', content: 'Why is she treating the state dump like me?' },
      ],
    }));

    expect({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
    }).toMatchSnapshot();
  });
});
