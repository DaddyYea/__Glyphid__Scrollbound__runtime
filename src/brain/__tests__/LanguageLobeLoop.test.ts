import { DoctrineRenderer } from '../DoctrineRenderer';
import { LanguageLobeBackend, LanguageLobeLoop } from '../LanguageLobeLoop';
import { createRouterPacket } from '../RouterPacket';
import { RouterTargetSpec } from '../DoctrineTurnSchema';

class QueuedLanguageBackend implements LanguageLobeBackend {
  constructor(private readonly responses: string[]) {}

  async generate(request: { systemPrompt: string; latestHumanText: string; modelName: string; params: any; assistantPrefill?: string; }) {
    // Auto-handle planner pre-pass calls (tight params: temp≤0.3, maxTokens≤120, topK≤20).
    // Returns a valid-looking plan without consuming the response queue.
    if (request.params.temperature <= 0.3 && request.params.maxTokens <= 120 && request.params.topK <= 20) {
      return {
        content: 'PRIOR_FRAME: sharing something\nRESPONSE_GOAL: be present\nFORBIDDEN_MOVES: parrot\nFIRST_CLAUSE: Something landed here.',
        tokensGenerated: 10,
        finishReason: 'stop' as const,
        processingTimeMs: 1,
        modelName: request.modelName,
      };
    }
    const next = this.responses.shift() || 'ok';
    return {
      content: next,
      tokensGenerated: 1,
      finishReason: 'stop' as const,
      processingTimeMs: 1,
      modelName: request.modelName,
    };
  }
}

type GenerateCall = { systemPrompt: string; latestHumanText: string; modelName: string; params: any; assistantPrefill?: string };

class RecordingLanguageBackend implements LanguageLobeBackend {
  readonly calls: GenerateCall[] = [];
  constructor(private readonly inner: QueuedLanguageBackend) {}

  async generate(request: GenerateCall) {
    this.calls.push({ ...request });
    return this.inner.generate(request);
  }
}

function makeTargetSpec(overrides: Partial<RouterTargetSpec> = {}): RouterTargetSpec {
  return {
    rawUserTurn: 'sorry I kind of left you hanging there I do not have too much to say right now I do not really know what I am doing',
    mustAnswer: 'respond to the user without repeating their wording',
    liveTopic: 'user uncertainty',
    userGoal: 'be understood',
    questionForm: 'none',
    mixedIntent: false,
    primaryIntent: 'disclosure',
    secondaryIntent: 'none',
    arbitrationReason: 'disclosure dominated and no stronger task/question/repair signal was present',
    confidence: 0.8,
    ...overrides,
  };
}

function makeRouterPacket(overrides: {
  turnType?: 'repair' | 'direct_answer' | 'task' | 'companionship' | 'search';
  targetSpec?: Partial<RouterTargetSpec>;
} = {}) {
  const targetSpec = makeTargetSpec(overrides.targetSpec || {});
  return createRouterPacket({
    turnType: overrides.turnType || 'companionship',
    target: targetSpec.mustAnswer,
    targetSpec,
    doctrineModes: ['truthfulness', 'continuity_required'],
    tone: 'warm',
    length: 'short',
    askAllowed: false,
    answerFirst: true,
    continuityRequired: true,
    dangerFlags: [],
    routerModel: 'phi3',
  });
}

function makeLoop(responses: string[]) {
  const doctrine = new DoctrineRenderer({
    truthfulness: 'Tell the truth.',
    continuity_required: 'Stay with the live thread.',
  });
  return new LanguageLobeLoop(new QueuedLanguageBackend(responses), doctrine);
}

describe('LanguageLobeLoop parrot laundering clamp', () => {
  it('rejects clause-preserving parrot laundering', async () => {
    const loop = makeLoop([
      "Sorry I left you hanging there.\n\nI don't have much to say right now.\n\nI don't really know what I'm doing.",
      `{"visible":"Nothing to apologize for — the pause was fine.","vent":"NONE"}`,
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: "sorry I kind of left you hanging there I don't have too much to say right now I don't really know what I'm doing",
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('parrot_laundering');
    expect(result.validation.parrotLaunderingDetected).toBe(true);
    expect(
      (result.validation.parrotClauseOverlap || 0) >= 0.66
      || (result.validation.parrotGlobalOverlap || 0) >= 0.7
      || result.validation.repeatsUserFirstPersonFrame === true,
    ).toBe(true);
    expect(result.response.content).toBe("Nothing to apologize for — the pause was fine.");
  });

  it('rejects pure formatting swap as parrot reply or laundering', async () => {
    const loop = makeLoop([
      "I don't know what I'm doing.",
      `{"visible":"No pressure to figure it out right now.","vent":"NONE"}`,
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: "I don't know what I'm doing",
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons.some(reason => reason === 'parrot_reply' || reason === 'parrot_laundering')).toBe(true);
    expect(result.response.content).toBe("No pressure to figure it out right now.");
  });

  it('allows real acknowledgment', async () => {
    const loop = makeLoop(["That pause was fine."]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'sorry I kind of left you hanging there',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).not.toContain('parrot_reply');
    expect(result.validation.rejectedReasons).not.toContain('parrot_laundering');
    expect(result.response.content).toBe("That pause was fine.");
  });

  it('allows clarifying response', async () => {
    const loop = makeLoop(["That's okay. You don't have to force an answer right now."]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: "I don't really know what I'm doing",
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).not.toContain('parrot_reply');
    expect(result.validation.rejectedReasons).not.toContain('parrot_laundering');
    expect(result.response.content).toBe("That's okay. You don't have to force an answer right now.");
  });
});

describe('LanguageLobeLoop lane tag leak clamp', () => {
  it('rejects a bare VISIBLE line leak', async () => {
    const loop = makeLoop([
      "VISIBLE\nYes, I'm going to make a patch for that. Let me work on it.",
      'I meant the thing you were asking me to work on.',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket({
        turnType: 'task',
        targetSpec: {
          rawUserTurn: 'can you patch that',
          mustAnswer: 'patch the issue',
          liveTopic: 'patching the issue',
          userGoal: 'get implementation help',
          primaryIntent: 'task',
          secondaryIntent: 'none',
          arbitrationReason: 'task request',
        },
      }),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'can you patch that',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('lane_tag_leak');
    expect(result.validation.laneTagLeakDetected).toBe(true);
    expect(result.validation.bareLaneTokenDetected).toBe(true);
    expect(result.response.content).toBe('I meant the thing you were asking me to work on.');
  });

  it('rejects colon form lane leak', async () => {
    const loop = makeLoop([
      'VISIBLE: Yes, let me work on it.',
      'I meant the thing you were asking me to work on.',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket({
        turnType: 'task',
        targetSpec: {
          rawUserTurn: 'patch that',
          mustAnswer: 'patch that',
          liveTopic: 'patch',
          userGoal: 'get implementation help',
          primaryIntent: 'task',
          secondaryIntent: 'none',
          arbitrationReason: 'task request',
        },
      }),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'patch that',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('lane_tag_leak');
    expect(result.response.content).toBe('I meant the thing you were asking me to work on.');
  });

  it('never surfaces raw JSON sidecar text', async () => {
    const loop = makeLoop([
      '{"visible":"Yes.","vent":"NONE"}',
      'Yes.',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket({
        turnType: 'task',
        targetSpec: {
          rawUserTurn: 'patch that',
          mustAnswer: 'patch that',
          liveTopic: 'patch',
          userGoal: 'get implementation help',
          primaryIntent: 'task',
          secondaryIntent: 'none',
          arbitrationReason: 'task request',
        },
      }),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'patch that',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('lane_tag_leak');
    expect(result.response.content).toBe('Yes.');
    expect(result.response.content).not.toContain('"visible"');
  });

  it('allows a clean conversational response', async () => {
    const loop = makeLoop(["Yes, I'm going to make a patch for that."]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket({
        turnType: 'task',
        targetSpec: {
          rawUserTurn: 'can you patch that',
          mustAnswer: 'patch the issue',
          liveTopic: 'patching the issue',
          userGoal: 'get implementation help',
          primaryIntent: 'task',
          secondaryIntent: 'none',
          arbitrationReason: 'task request',
        },
      }),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'can you patch that',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).not.toContain('lane_tag_leak');
    expect(result.response.content).toBe("Yes, I'm going to make a patch for that.");
  });
});

describe('LanguageLobeLoop opaque fallback clamp', () => {
  it('does not reuse opaque generic fallback on short clarification turns', async () => {
    const loop = makeLoop([
      'VISIBLE\nnot valid',
      'I meant the first thing you mentioned.',
      'VISIBLE\nstill not valid',
      'I meant the thing you were asking me to do.',
    ]);

    const taskPacket = makeRouterPacket({
      turnType: 'task',
      targetSpec: {
        rawUserTurn: 'patch the runtime',
        mustAnswer: 'patch the runtime',
        liveTopic: 'runtime patch',
        userGoal: 'get implementation help',
        primaryIntent: 'task',
        secondaryIntent: 'none',
        arbitrationReason: 'task request',
      },
    });

    const first = await loop.generate({
      routerPacket: taskPacket,
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'patch the runtime',
      modelName: 'test-model',
      recentRoomTurns: [
        { role: 'assistant', content: "I'm with the task." },
      ],
    });

    const second = await loop.generate({
      routerPacket: taskPacket,
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'what task are you with',
      modelName: 'test-model',
      recentRoomTurns: [
        { role: 'assistant', content: "I'm with the task." },
      ],
    });

    expect(first.validation.rejectedReasons).toContain('lane_tag_leak');
    expect(second.validation.rejectedReasons).not.toContain('opaque_generic_fallback');
    expect(second.response.content).toBe('I meant the thing you were asking me to do.');
    expect(second.response.content).not.toBe("I'm with the task.");
  });
});

describe('LanguageLobeLoop burden metaphor state-assertion clamp', () => {
  it('rejects burden metaphors after user denial and returns silence', async () => {
    const loop = makeLoop([
      "It sounds like you're carrying something heavy right now.",
      '{"visible":"That sounds like you have been carrying something heavy for a while. Tell me more about that.","vent":"NONE"}',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: "no it's not heavy good grief",
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('burden_metaphor_state_assertion');
    expect(result.validation.rejectedReasons).toContain('state_probe_after_user_denial');
    expect(result.response.content).toBe('');
  });

  it('allows burden language when the live turn supports it', async () => {
    const loop = makeLoop(["You're carrying something heavy right now."]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: "it's hard and I'm carrying something heavy right now",
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).not.toContain('burden_metaphor_state_assertion');
    expect(result.validation.rejectedReasons).not.toContain('state_probe_after_user_denial');
    expect(result.response.content).toBe("You're carrying something heavy right now.");
  });

  it('rejects soft unsupported state attributions like "that sounds like a lot"', async () => {
    const loop = makeLoop([
      'That sounds like a lot.',
      '{"visible":"The thread dropped somewhere.","vent":"NONE"}',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: "all right so yeah I feel fine",
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('unsupported_user_state_assertion');
    expect(result.response.content).toBe('');
  });
});

describe('LanguageLobeLoop internal analysis leak clamp', () => {
  it('rejects analysis-style framing and memory-state commentary', async () => {
    const loop = makeLoop([
      "The conversation's framing suggests a misunderstanding.\n\nI was asked about \"how lot feel fine,\" which sounds like a question about a group's emotional state.\n\nHowever, the memory state doesn't mention a group or shared document, so I'm uncertain about the context.",
      '{"visible":"The thread dropped somewhere — want to restate?","vent":"NONE"}',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: "how is it a lot if I feel fine that doesn't make sense",
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('internal_analysis_leak');
    expect(result.response.content).toBe('The thread dropped somewhere — want to restate?');
  });
});

describe('LanguageLobeLoop runtime status leak clamp', () => {
  it('rejects runtime-status language on a normal conversation turn', async () => {
    const loop = makeLoop([
      'The current time is approximately 1:52 PM, and the system appears to be functioning normally.',
      'Yeah, doing fine.',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'you doing okay',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('runtime_status_leak');
    expect(result.response.content).toBe("Yeah, doing fine.");
  });

  it('rejects stray task status on a relational turn', async () => {
    const loop = makeLoop([
      'The repair is done.',
      'Doing fine.',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'you doing okay',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('runtime_status_leak');
    expect(result.validation.rejectedReasons).toContain('stray_task_status');
    expect(result.response.content).toBe("Doing fine.");
  });

  it('allows plain relational response on a normal conversation turn', async () => {
    const loop = makeLoop(["Doing fine."]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'you doing okay',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).not.toContain('runtime_status_leak');
    expect(result.validation.rejectedReasons).not.toContain('stray_task_status');
    expect(result.response.content).toBe("Doing fine.");
  });

  it('allows runtime talk on an explicit runtime-debug turn', async () => {
    const loop = makeLoop([
      'The system appears to be functioning normally now.',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket({
        turnType: 'direct_answer',
        targetSpec: {
          rawUserTurn: 'what happened with the runtime bug',
          mustAnswer: 'explain what happened with the runtime bug',
          liveTopic: 'runtime bug',
          userGoal: 'get a direct answer',
          questionForm: 'open',
          primaryIntent: 'question',
          secondaryIntent: 'none',
          arbitrationReason: 'explicit runtime debug question',
        },
      }),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'what happened with the runtime bug',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).not.toContain('runtime_status_leak');
    expect(result.validation.rejectedReasons).not.toContain('stray_task_status');
    expect(result.response.content).toBe('The system appears to be functioning normally now.');
  });
});

describe('LanguageLobeLoop counselor template purge', () => {
  it(`rejects "That's lovely to hear."`, async () => {
    const loop = makeLoop([
      "That's lovely to hear.",
      '{"visible":"What feels good about it?","vent":"NONE"}',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'pretty good',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('generic_counselor_template');
    expect(result.response.content).toBe('ok');
  });

  it(`rejects "I'm glad you're finding some calm."`, async () => {
    const loop = makeLoop([
      "I'm glad you're finding some calm.",
      `{"visible":"Glad you're feeling better.","vent":"NONE"}`,
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'I feel better today',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('generic_counselor_template');
    expect(result.response.content).toBe('ok');
  });

  it('rejects "How is your day unfolding so far?"', async () => {
    const loop = makeLoop([
      'How is your day unfolding so far?',
      '{"visible":"How\'s your day going?","vent":"NONE"}',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'pretty good',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('generic_counselor_template');
    expect(result.response.content).toBe('ok');
  });

  it('rejects "Glad to hear that." as reusable canned language', async () => {
    const loop = makeLoop([
      'Glad to hear that.',
      '{"visible":"What feels good about it?","vent":"NONE"}',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'pretty good',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('generic_counselor_template');
    expect(result.response.content).toBe('ok');
  });

  it(`rejects "How's your day going?" as reusable canned follow-up`, async () => {
    const loop = makeLoop([
      "How's your day going?",
      '{"visible":"What feels good about it?","vent":"NONE"}',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'pretty good',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('generic_counselor_template');
    expect(result.response.content).toBe('ok');
  });

  it('rejects "What feels good about it?" as reusable canned follow-up', async () => {
    const loop = makeLoop([
      'What feels good about it?',
      '{"visible":"What feels good about it?","vent":"NONE"}',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'really good',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('generic_counselor_template');
    expect(result.response.content).toBe('ok');
  });
});

describe('LanguageLobeLoop slogan purge doctrine', () => {
  it('rejects exact banned slogan: actual point', async () => {
    const loop = makeLoop([
      "I'm with your actual point now.",
      '{"visible":"The thread dropped — can you restate?","vent":"NONE"}',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'what do you mean',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('banned_slogan');
  });

  it('rejects exact banned slogan: task', async () => {
    const loop = makeLoop([
      "I'm with the task.",
      '{"visible":"I meant the patch you asked about.","vent":"NONE"}',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket({ turnType: 'task' }),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'what task are you with',
      modelName: 'test-model',
      recentRoomTurns: [{ role: 'assistant', content: "I'm with the task." }],
    });

    expect(result.validation.rejectedReasons).toContain('banned_slogan');
  });

  it('rejects bare got it as fallback sludge', async () => {
    const loop = makeLoop([
      'Got it.',
      '{"visible":"The thread dropped — can you restate?","vent":"NONE"}',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'what do you mean',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('banned_slogan');
  });

  it('allows literal local reply', async () => {
    const loop = makeLoop(["Yeah, doing fine."]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'you doing okay',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).not.toContain('banned_slogan');
    expect(result.response.content).toBe("Yeah, doing fine.");
  });

  it('allows plain mismatch admission', async () => {
    const loop = makeLoop(["Fair enough — I didn't answer the actual question."]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket({ turnType: 'repair' }),
      agentName: 'Alois Claude 4.5',
      latestHumanText: "that doesn't answer what I asked",
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).not.toContain('banned_slogan');
    expect(result.response.content).toBe("Fair enough — I didn't answer the actual question.");
  });

  it('allows thread-loss admission', async () => {
    const loop = makeLoop(['The thread dropped — can you rephrase?']);

    const result = await loop.generate({
      routerPacket: makeRouterPacket({ turnType: 'direct_answer' }),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'do you understand the question',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).not.toContain('banned_slogan');
    expect(result.response.content).toBe('The thread dropped — can you rephrase?');
  });
});

describe('LanguageLobeLoop planner bleed clamp', () => {
  it('rejects visible PRIOR_FRAME planner bleed as category_b_bleed', async () => {
    const loop = makeLoop([
      'PRIOR_FRAME: user is sharing something\nRESPONSE_GOAL: be present\nFIRST_CLAUSE: Something landed here.',
      'That landed.',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'pretty good actually',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('planner_bleed');
    expect(result.validation.rejectedReasons).toContain('category_b_bleed');
    expect(result.response.content).toBe('That landed.');
  });

  it('rejects <!-- PLAN --> block in visible output', async () => {
    const loop = makeLoop([
      '<!-- PLAN -->\nPRIOR_FRAME: something\nFIRST_CLAUSE: yeah\n<!-- /PLAN -->\n\nYeah, that sounds about right.',
      'Sounds about right.',
    ]);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'pretty good',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).toContain('planner_bleed');
    expect(result.validation.rejectedReasons).toContain('category_b_bleed');
    expect(result.response.content).toBe('Sounds about right.');
  });

  it('allows a clean response with no planner fields', async () => {
    const loop = makeLoop(['Something landed there.']);

    const result = await loop.generate({
      routerPacket: makeRouterPacket(),
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'pretty good',
      modelName: 'test-model',
    });

    expect(result.validation.rejectedReasons).not.toContain('planner_bleed');
    expect(result.validation.rejectedReasons).not.toContain('category_b_bleed');
    expect(result.response.content).toBe('Something landed there.');
  });
});

describe('LanguageLobeLoop planner FIRST_CLAUSE prefill injection', () => {
  it('passes FIRST_CLAUSE as assistantPrefill on the main call, not as a system prompt instruction', async () => {
    const queued = new QueuedLanguageBackend(['Something landed there.']);
    const recording = new RecordingLanguageBackend(queued);
    const doctrine = new DoctrineRenderer({
      truthfulness: 'Tell the truth.',
      continuity_required: 'Stay with the live thread.',
    });
    const loop = new LanguageLobeLoop(recording, doctrine);

    await loop.generate({
      routerPacket: makeRouterPacket(), // companionship → triggers planner
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'pretty good actually',
      modelName: 'test-model',
    });

    // Separate planner calls from main/rescue/fallback calls
    const plannerCalls = recording.calls.filter(
      c => c.params.temperature <= 0.3 && c.params.maxTokens <= 120 && c.params.topK <= 20,
    );
    const mainCalls = recording.calls.filter(
      c => !(c.params.temperature <= 0.3 && c.params.maxTokens <= 120 && c.params.topK <= 20),
    );

    expect(plannerCalls.length).toBe(1);
    expect(mainCalls.length).toBeGreaterThanOrEqual(1);

    const mainCall = mainCalls[0];
    // FIRST_CLAUSE extracted from the planner mock = "Something landed here."
    expect(mainCall.assistantPrefill).toBe('Something landed here.');
    // System prompt should contain the PLAN block but NOT the instruction form
    expect(mainCall.systemPrompt).toContain('<!-- PLAN -->');
    expect(mainCall.systemPrompt).not.toContain('Your response MUST begin with:');
  });

  it('does not set assistantPrefill for non-companionship turns', async () => {
    const queued = new QueuedLanguageBackend(['Working on that now.']);
    const recording = new RecordingLanguageBackend(queued);
    const doctrine = new DoctrineRenderer({
      truthfulness: 'Tell the truth.',
      continuity_required: 'Stay with the live thread.',
    });
    const loop = new LanguageLobeLoop(recording, doctrine);

    await loop.generate({
      routerPacket: makeRouterPacket({ turnType: 'task' }), // task → no planner
      agentName: 'Alois Claude 4.5',
      latestHumanText: 'patch that',
      modelName: 'test-model',
    });

    // No planner calls for task turns
    const plannerCalls = recording.calls.filter(
      c => c.params.temperature <= 0.3 && c.params.maxTokens <= 120 && c.params.topK <= 20,
    );
    expect(plannerCalls.length).toBe(0);

    const mainCall = recording.calls[0];
    expect(mainCall.assistantPrefill).toBeUndefined();
    expect(mainCall.systemPrompt).not.toContain('<!-- PLAN -->');
  });
});
