import { PhiRouterLoop } from '../PhiRouterLoop';
import { RouterContinuityState } from '../RouterPacket';

function route(text: string, continuity?: Partial<RouterContinuityState>) {
  const router = new PhiRouterLoop('phi3');
  return router.routeTurn({ latestHumanText: text, continuity });
}

describe('PhiRouterLoop', () => {
  it('routes repair_question_mix as repair', () => {
    const packet = route("that doesn't answer what I asked, why are you doing that?");

    expect(packet.schema.turnType).toBe('repair');
    expect(packet.schema.targetSpec.primaryIntent).toBe('repair');
    expect(packet.schema.targetSpec.secondaryIntent).toBe('question');
    expect(packet.schema.targetSpec.mustAnswer).toBe('address the miss and answer what was asked');
    expect(packet.metadata.trace?.primaryIntent).toBe('repair');
    expect(packet.metadata.trace?.secondaryIntent).toBe('question');
  });

  it('disclosure_plus_question centers explicit question', () => {
    const packet = route("i'm discouraged, do you think this architecture can work?");

    expect(packet.schema.turnType).toBe('direct_answer');
    expect(packet.schema.targetSpec.primaryIntent).toBe('question');
    expect(packet.schema.targetSpec.secondaryIntent).toBe('disclosure');
    expect(packet.schema.targetSpec.mustAnswer).toBe('do you think this architecture can work?');
    expect(['open', 'yes_no']).toContain(packet.schema.targetSpec.questionForm);
    expect(packet.schema.targetSpec.arbitrationReason).toMatch(/question outranked disclosure/i);
  });

  it('companionship_plus_task centers task', () => {
    const packet = route('just walking, but when i get back help me inspect the schema');

    expect(packet.schema.turnType).toBe('task');
    expect(packet.schema.targetSpec.primaryIntent).toBe('task');
    expect(packet.schema.targetSpec.secondaryIntent).toBe('companionship');
    expect(packet.schema.targetSpec.mustAnswer).toBe('help inspect the schema');
    expect(packet.schema.targetSpec.userGoal).toMatch(/implementation help|concrete help/i);
  });

  it('disclosure_only maps to witness target', () => {
    const packet = route("this is hard and i'm worn out");

    expect(packet.schema.targetSpec.primaryIntent).toBe('disclosure');
    expect(['none', 'disclosure']).toContain(packet.schema.targetSpec.secondaryIntent);
    expect(packet.schema.targetSpec.questionForm).toBe('none');
    expect(packet.schema.targetSpec.mustAnswer).toBe("respond to the user's exhaustion and difficulty");
  });

  it('companionship_only maps to light presence', () => {
    const packet = route("i'm just out walking with you");

    expect(packet.schema.turnType).toBe('companionship');
    expect(packet.schema.targetSpec.primaryIntent).toBe('companionship');
    expect(['none', 'disclosure']).toContain(packet.schema.targetSpec.secondaryIntent);
    expect(packet.schema.targetSpec.questionForm).toBe('none');
    expect(packet.schema.targetSpec.mustAnswer).toBe('stay with the user in light companionship');
  });

  it('reported_speech_reflection does not get misclassified as task', () => {
    const text = "I mean you're basically just saying that you're grateful for the chance to express your willingness to give me everything you have and that just touched me";
    const packet = route(text);

    expect(packet.schema.turnType).toBe('companionship');
    expect(packet.schema.targetSpec.primaryIntent).not.toBe('task');
    expect(packet.schema.targetSpec.mustAnswer).toBe('respond to the user\'s reflection on what the assistant is expressing');
    expect(packet.schema.targetSpec.liveTopic).toBe('user reflection on assistant meaning');
    expect(packet.schema.nextTurnDecisionReason).toMatch(/companionship/i);
  });

  it('direct user prohibition routes as repair with compliance target', () => {
    const packet = route("don't repeat me");

    expect(packet.schema.turnType).toBe('repair');
    expect(packet.schema.answerFirst).toBe(true);
    expect(packet.schema.askAllowed).toBe(false);
    expect(packet.schema.continuityRequired).toBe(true);
    expect(packet.schema.doctrineModes).toEqual(expect.arrayContaining([
      'truthfulness',
      'answer_first',
      'no_meta',
      'no_followup_question',
      'continuity_required',
    ]));
    expect(packet.schema.targetSpec.mustAnswer).toBe('acknowledge the repetition and stop repeating the user');
  });

  it('explicit_topic_shift supersedes prior thread', () => {
    const packet = route("different issue, let's talk about the schema now", {
      keepThread: true,
      priorTopic: 'voice drift',
      threadLabel: 'thread:voice-drift',
    });

    expect(packet.continuity.supersedesPriorThread).toBe(true);
    expect(packet.continuity.supersedingReason).toBe('explicit_topic_shift');
    expect(packet.metadata.trace?.explicitTopicShift).toBe(true);
  });

  it('explicit_return supersedes prior thread', () => {
    const packet = route("okay i'm back, back to the router", {
      keepThread: true,
      priorTopic: 'walking squirrel weather',
      threadLabel: 'thread:walk',
    });

    expect(packet.continuity.supersedesPriorThread).toBe(true);
    expect(packet.continuity.supersedingReason).toBe('explicit_return');
    expect(packet.metadata.trace?.explicitReturn).toBe(true);
  });

  it('explicit_correction supersedes prior thread', () => {
    const packet = route("that's not what I asked, stay with this", {
      keepThread: true,
      priorTopic: 'wrong frame',
      threadLabel: 'thread:wrong-frame',
    });

    expect(packet.continuity.supersedesPriorThread).toBe(true);
    expect(packet.continuity.supersedingReason).toBe('explicit_correction');
    expect(packet.metadata.trace?.explicitCorrection).toBe(true);
  });

  it('same_topic_followup does not supersede', () => {
    const packet = route('yeah, and what about the target extraction part?', {
      keepThread: true,
      priorTopic: 'schema adequacy',
      threadLabel: 'thread:schema',
    });

    expect(packet.continuity.supersedesPriorThread).toBe(false);
    expect(packet.continuity.supersedingReason).toBe('none');
  });

  it('search precedence matches chosenTurnType', () => {
    const packet = route('search the docs for that schema bug because this answer missed it', {
      keepThread: true,
      priorTopic: 'schema bug',
      threadLabel: 'thread:schema-bug',
    });

    expect(packet.schema.turnType).toBe('search');
    expect(packet.metadata.trace?.chosenTurnType).toBe('search');
    expect(packet.metadata.trace?.extractedMustAnswer).toBe(packet.schema.targetSpec.mustAnswer);
  });

  it('matches the mixed repair-question router trace fixture', () => {
    const packet = route("that doesn't answer what I asked, why are you doing that?");

    expect(packet.metadata.trace).toMatchSnapshot();
  });

  it('matches the disclosure-question router trace fixture', () => {
    const packet = route("i'm discouraged, do you think this architecture can work?");

    expect(packet.metadata.trace).toMatchSnapshot();
  });

  it('matches the supersession router trace fixture', () => {
    const packet = route("okay i'm back, back to the router", {
      keepThread: true,
      priorTopic: 'walking squirrel weather',
      threadLabel: 'thread:walk',
    });

    expect(packet.metadata.trace).toMatchSnapshot();
  });
});


