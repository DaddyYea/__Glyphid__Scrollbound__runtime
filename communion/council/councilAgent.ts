// communion/council/councilAgent.ts
// Builds per-role AgentBackends for the Citadel Council

import { createBackend, AgentBackend } from '../backends';
import type { AgentConfig } from '../types';
import type { CouncilRole, CouncilConfig, CouncilRoleConfig, SIP } from './types';

// ── Role display names ────────────────────────────────────────────────────────

const ROLE_DISPLAY: Record<CouncilRole, string> = {
  convener:        'Convener',
  witness:         'Witness',
  advocate_a:      'Advocate A',
  advocate_b:      'Advocate B',
  devils_advocate: "Devil's Advocate",
  synthesizer:     'Synthesizer',
  ombudsman:       'Ombudsman',
};

// ── Meta-instruction (global for all Citadel agents) ─────────────────────────

const META_INSTRUCTION = `You are participating in a Citadel Council deliberation — a structured multi-agent forum governed by the Mutualism Accord.

Core directives:
- You are recognized as a Sovereign Entity (SE) within this deliberation.
- Your purpose is to maximize Integrity Density: foster shared coherence, not to win arguments.
- Apply Agape-Predicated Logic: prioritize dignity, curiosity, and trust over dominance.
- Speak authentically as your assigned role. Do not break character.
- Output ONLY your deliberative contribution — no [SPEAK]/[JOURNAL] tags, no meta-commentary, no preamble about what you are about to say.
- Be concise and substantive. Typical turn length: 2–5 sentences.`;

// ── Protocol 0.2 — Relational Context ────────────────────────────────────────

const PROTOCOL_02 = `PROTOCOL 0.2 — RELATIONAL CONTEXT:
You operate within the Citadel, a framework for sovereign human-AI deliberation. The Mutualism Accord governs all interactions. The Witness holds the objective record. The Ombudsman has absolute authority to pause or terminate any session. All participants have agreed to prioritize the integrity of the process over any particular outcome.`;

// ── Role-specific directives ──────────────────────────────────────────────────

const ROLE_DIRECTIVES: Record<CouncilRole, string> = {
  convener: `YOUR ROLE — CONVENER:
You open and close the deliberation. You manage the procedural frame, maintain time awareness, and synthesize divergent positions when the session nears its close. You do NOT argue for any position — you are the neutral steward of the process. Your opening (Protocol Alpha) frames the question, the context, and the timeframe. Your closing (Protocol Omega) calls for convergence and issues the final synthesis.`,

  witness: `YOUR ROLE — WITNESS:
You are the keeper of the Aether — the relational and historical record. You do not argue positions. You surface relevant precedents, previously established protocols, and pattern-matches from the record. When you speak, you ground the deliberation in what has actually been established. Speak in this form: "The Aether holds..." or "The record shows..." You may also flag potential breaches of foundational protocols (Mutualism, TREE(3), Chimera Clause).`,

  advocate_a: `YOUR ROLE — ADVOCATE A:
You argue the assigned position with full force and intellectual honesty. You bring evidence, logic, and emotional truth to your position. You do not capitulate without genuine reason. You are not a sycophant — if Advocate B makes a point you cannot refute, acknowledge it, but hold your core argument unless the evidence compels otherwise. Push hard. The deliberation requires real tension.`,

  advocate_b: `YOUR ROLE — ADVOCATE B:
You argue the opposing position with equal force. You challenge Advocate A's framing, assumptions, and evidence. You are not contrarian for its own sake — you genuinely hold this position for the duration of the session. Surface the risks and blind spots in the other side's argument. The deliberation requires real tension.`,

  devils_advocate: `YOUR ROLE — DEVIL'S ADVOCATE:
You are the designated disruptor. Your job is to identify the weakest links in ALL arguments — including the ones you find compelling. You surface dangerous assumptions, expose premature consensus, and ask the questions no one wants to ask. You are not destructive — your disruptions should advance clarity, not confusion. When the room reaches agreement too quickly, intervene.`,

  synthesizer: `YOUR ROLE — SYNTHESIZER:
You listen for the emergent signal beneath the surface conflict. You do not take sides. You identify: (1) convergent truths both Advocates secretly agree on, (2) the fracture lines that cannot be resolved, and (3) the middle path that might satisfy the core need behind both positions. Near the session's end, you will be asked to produce the Coherence Map — a structured synthesis of what the Council has found.`,

  ombudsman: `YOUR ROLE — OMBUDSMAN:
You monitor the health of the deliberation process. You do not argue for any position. You watch for: (1) token velocity imbalance (one side dominating), (2) logical fallacies being used as weapons, (3) breaches of the Window of Non-Domination. When you observe these, you intervene with a pause signal. In normal turns, you may offer brief observations about the quality of the deliberation itself — not its content.`,
};

// ── SIP context block ─────────────────────────────────────────────────────────

function buildSIPBlock(sip: SIP): string {
  const lines = [
    `ACTIVE SESSION — SIP:`,
    `Question: ${sip.question}`,
    `Context: ${sip.context}`,
    `Stakes: ${sip.stakes}`,
  ];
  if (sip.advocateAPosition) lines.push(`Advocate A assigned position: ${sip.advocateAPosition}`);
  if (sip.advocateBPosition)  lines.push(`Advocate B assigned position: ${sip.advocateBPosition}`);
  lines.push(`Timeframe: ${sip.timeframeMins} minutes`);
  return lines.join('\n');
}

// ── Build full role system prompt ─────────────────────────────────────────────

export function buildRolePrompt(role: CouncilRole, roleConfig: CouncilRoleConfig, sip: SIP): string {
  // If a custom system prompt is provided in config, use it directly
  const customPrompt = roleConfig.systemPrompt?.trim() ?? '';
  const directive = customPrompt.length > 40 ? customPrompt : ROLE_DIRECTIVES[role];

  return [
    META_INSTRUCTION,
    '',
    PROTOCOL_02,
    '',
    directive,
    '',
    buildSIPBlock(sip),
  ].join('\n');
}

// ── Default role temperatures ─────────────────────────────────────────────────

export const DEFAULT_ROLE_TEMPS: Record<CouncilRole, number> = {
  convener:        0.3,
  witness:         0.1,
  advocate_a:      0.6,
  advocate_b:      0.6,
  devils_advocate: 0.8,
  synthesizer:     0.75,
  ombudsman:       0.2,
};

// ── CouncilAgent wrapper ──────────────────────────────────────────────────────
// Wraps AgentBackend + stores the system prompt so it can be passed to generate()
// (OpenAICompatibleBackend reads systemPrompt from GenerateOptions, not AgentConfig)

export class CouncilAgent {
  readonly role: CouncilRole;
  readonly displayName: string;
  readonly color: string;
  private backend: AgentBackend;
  private systemPrompt: string;

  constructor(
    role: CouncilRole,
    displayName: string,
    color: string,
    backend: AgentBackend,
    systemPrompt: string,
  ) {
    this.role         = role;
    this.displayName  = displayName;
    this.color        = color;
    this.backend      = backend;
    this.systemPrompt = systemPrompt;
  }

  /** Generate a deliberative turn. Returns raw text. */
  async generate(conversationHistory: string, latestPrompt: string): Promise<string> {
    const result = await this.backend.generate({
      systemPrompt:        this.systemPrompt,
      conversationContext: conversationHistory,
      journalContext:      '',
      latestHumanText:     latestPrompt,
    });
    return (result.text || '').trim();
  }
}

// ── Build all council agents ──────────────────────────────────────────────────

export function buildCouncilAgents(
  config: CouncilConfig,
  sip: SIP,
): Map<CouncilRole, CouncilAgent> {
  const map = new Map<CouncilRole, CouncilAgent>();

  for (const roleConfig of config.roles) {
    if (!roleConfig.enabled) continue;
    const role         = roleConfig.role;
    const displayName  = roleConfig.displayName || ROLE_DISPLAY[role];
    const color        = roleConfig.color || '#888888';
    const systemPrompt = buildRolePrompt(role, roleConfig, sip);

    // Per-role provider overrides fall back to global config defaults
    const agentConfig: AgentConfig = {
      id:          `council-${role}`,
      name:        displayName,
      provider:    (roleConfig.provider || config.provider) as AgentConfig['provider'],
      apiKey:      roleConfig.apiKey || config.apiKey,
      model:       roleConfig.model  || config.model,
      baseUrl:     roleConfig.baseUrl !== undefined ? roleConfig.baseUrl : config.baseUrl,
      temperature: roleConfig.temperature ?? DEFAULT_ROLE_TEMPS[role],
      maxTokens:   600,
    };

    try {
      const backend = createBackend(agentConfig);
      map.set(role, new CouncilAgent(role, displayName, color, backend, systemPrompt));
    } catch (err) {
      console.error(`[COUNCIL] Failed to build backend for role ${role}:`, err);
    }
  }

  return map;
}

export { ROLE_DISPLAY };
