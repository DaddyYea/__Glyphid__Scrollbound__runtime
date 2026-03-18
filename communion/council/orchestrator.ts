// communion/council/orchestrator.ts
// Session lifecycle manager for the Citadel Council

import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AetherStore } from './aetherStore';
import { buildCouncilAgents, CouncilAgent, ROLE_DISPLAY } from './councilAgent';
import { MemoryRecall } from '../memoryRecall';
import type {
  CouncilConfig,
  CouncilRole,
  CouncilSession,
  CouncilStatus,
  CouncilTurn,
  OmbudsmanAlert,
  SIP,
  SIPValidationResult,
  WitnessRecall,
} from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

const TURN_INTERVAL_MS  = 9_000;   // delay between agent turns
const TURN_ORDER: CouncilRole[] = ['witness', 'advocate_a', 'advocate_b', 'devils_advocate', 'synthesizer'];
// Council is AI-to-AI deliberation by design — humans observe and interject occasionally.
// Threshold is intentionally high; guard also requires ≥3 human messages to fire.
const TOKEN_VELOCITY_THRESHOLD      = 100;
const TOKEN_VELOCITY_MIN_HUMAN_MSGS = 3;

// ── Protocol Alpha (Convener opening) ────────────────────────────────────────

function buildProtocolAlpha(sip: SIP): string {
  return `[PROTOCOL ALPHA — SESSION OPEN]

The Council is now in session. Session ID: ${new Date().toISOString().slice(0, 10)}.

The question before us:
"${sip.question}"

Context: ${sip.context}

Stakes: ${sip.stakes}

Assigned positions:
- Advocate A will argue: ${sip.advocateAPosition || '(open position)'}
- Advocate B will argue: ${sip.advocateBPosition || '(open position)'}

We have ${sip.timeframeMins} minutes. The Mutualism Accord governs our deliberation. The Witness holds the record. The Ombudsman guards the integrity of this process.

Let the Witness open the record.`;
}

// ── Protocol Omega (Convener closing) ────────────────────────────────────────

function buildProtocolOmega(session: CouncilSession): string {
  const elapsed = Math.round((Date.now() - session.startedAt) / 60000);
  return `[PROTOCOL OMEGA — SESSION CLOSING]

The timeframe has elapsed. ${elapsed} minutes of deliberation are on record.

I call upon the Synthesizer to render the Coherence Map — the emergent signal from this deliberation.

After which, the Witness will provide the final Aether Audit Summary.

The Council has fulfilled its mandate. What has been spoken is now part of the record.`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newSessionId(): string {
  const date  = new Date().toISOString().slice(0, 10);
  const short = randomBytes(3).toString('hex').toUpperCase();
  return `CC-${date}-${short}`;
}

function shortId(): string {
  return randomBytes(3).toString('hex').toUpperCase();
}

function countTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 chars
  return Math.ceil(text.length / 4);
}

function formatHistory(turns: CouncilTurn[], maxTurns = 20): string {
  const recent = turns.slice(-maxTurns);
  return recent.map(t => {
    const speaker = t.agentName || ROLE_DISPLAY[t.role] || t.role;
    return `[${speaker}]: ${t.text}`;
  }).join('\n\n');
}

// ── CouncilOrchestrator ───────────────────────────────────────────────────────

export class CouncilOrchestrator {
  private dataDir:       string;
  private config:        CouncilConfig | null = null;
  private session:       CouncilSession | null = null;
  private agents:        Map<CouncilRole, CouncilAgent> = new Map();
  public  aether:        AetherStore;
  private memoryRecall:  MemoryRecall;
  private turnTimer:     NodeJS.Timeout | null = null;
  private closeTimer:    NodeJS.Timeout | null = null;
  private turnIndex      = 0;
  private running        = false;
  private broadcast:     (type: string, payload: unknown) => void;

  constructor(dataDir: string, broadcast: (type: string, payload: unknown) => void) {
    this.dataDir      = dataDir;
    this.broadcast    = broadcast;
    this.aether       = new AetherStore(dataDir);
    this.memoryRecall = new MemoryRecall(dataDir);
    this._loadConfig();
  }

  // ── Config ────────────────────────────────────────────────────────────────

  private _loadConfig(): void {
    const configPath = join(this.dataDir, 'council', 'council.config.json');
    if (!existsSync(configPath)) return;
    try {
      this.config = JSON.parse(readFileSync(configPath, 'utf-8')) as CouncilConfig;
    } catch (err) {
      console.error('[COUNCIL] Failed to load config:', err);
    }
  }

  saveConfig(config: CouncilConfig): void {
    const dir = join(this.dataDir, 'council');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'council.config.json'), JSON.stringify(config, null, 2), 'utf-8');
    this.config = config;
    console.log('[COUNCIL] Config saved');
  }

  getConfig(): CouncilConfig | null {
    return this.config;
  }

  isConfigured(): boolean {
    return !!(this.config?.apiKey && this.config.apiKey.trim().length > 0);
  }

  // ── SIP Validation ────────────────────────────────────────────────────────

  validateSIP(sip: SIP): SIPValidationResult {
    const errors: string[] = [];
    if (!sip.question?.trim()) {
      errors.push('question is required');
    } else if (!sip.question.trim().endsWith('?')) {
      errors.push('question must end with a question mark');
    }
    if (!sip.context?.trim() || sip.context.trim().split(/\s+/).length < 3) {
      errors.push('context must be at least 3 words');
    }
    if (!sip.stakes?.trim()) {
      errors.push('stakes must be specified');
    }
    return { valid: errors.length === 0, errors };
  }

  // ── Session Lifecycle ─────────────────────────────────────────────────────

  async startSession(sip: SIP): Promise<{ ok: boolean; error?: string; session?: CouncilSession }> {
    if (!this.config) return { ok: false, error: 'Council is not configured' };
    if (!this.isConfigured()) return { ok: false, error: 'API key is not set' };
    if (this.session?.status === 'active' || this.session?.status === 'sip_review') {
      return { ok: false, error: 'A session is already active' };
    }

    const validation = this.validateSIP(sip);
    if (!validation.valid) {
      return { ok: false, error: `SIP validation failed: ${validation.errors.join('; ')}` };
    }

    // Seed CAMP protocols if configured
    if (this.config.aetherSeedFromCAMP) {
      await this.aether.seedCAMP();
    }

    // Build agent backends
    this.agents = buildCouncilAgents(this.config, sip);
    if (this.agents.size === 0) {
      return { ok: false, error: 'No agents could be built — check config' };
    }

    const now        = Date.now();
    const timeoutMs  = (sip.timeframeMins || this.config.defaultTimeframeMins || 45) * 60 * 1000;
    const sessionId  = newSessionId();

    this.session = {
      sessionId,
      status:           'active',
      sip,
      startedAt:        now,
      expiresAt:        now + timeoutMs,
      turns:            [],
      aetherRecalls:    [],
      ombudsmanAlerts:  [],
      tokenVelocity: {
        aiTokens:    0,
        humanTokens: 0,
        ratio:       0,
        lastChecked: now,
      },
      integrityDensity: 0.5,
    };

    this.turnIndex = 0;
    this.running   = true;

    // Post Protocol 0.1 announcement
    this._postSystemTurn('convener', `[PROTOCOL 0.1 — CODE OF CONDUCT]\nThis Council operates under the Mutualism Accord. Mandate of Non-Domination is in effect. The Witness holds the record. The Ombudsman may pause at any time.`);

    // Cross-session memory brief — Witness surfaces relevant anchors from past sessions
    const memoryBrief = await this.memoryRecall.recallNow(sip.question + ' ' + sip.context, 5, 5);
    if (memoryBrief) {
      this._postSystemTurn('witness',
        `[WITNESS — OPENING MEMORY BRIEF]\nRelevant anchors from the Aether (cross-session memory):\n${memoryBrief}`);
    }

    // Fire Protocol Alpha from Convener
    await this._fireConvenerTurn(buildProtocolAlpha(sip));

    // Start turn cycle
    this._scheduleNextTurn();

    // Auto-close timer
    this.closeTimer = setTimeout(() => {
      this._fireClosing('timer').catch(err => console.error('[COUNCIL] Close error:', err));
    }, timeoutMs);

    this.broadcast('council_status', this._statusPayload());
    return { ok: true, session: this.session };
  }

  pauseSession(reason = 'Manually paused'): boolean {
    if (!this.session || this.session.status !== 'active') return false;
    this.session.status = 'paused';
    this.running = false;
    this._clearTurnTimer();

    const alert: OmbudsmanAlert = {
      id:        shortId(),
      timestamp: new Date().toISOString(),
      reason,
      severity:  'pause',
    };
    this.session.ombudsmanAlerts.push(alert);
    this.broadcast('council_pause', { alert, session: this._statusPayload() });
    console.log(`[COUNCIL] Paused: ${reason}`);
    return true;
  }

  resumeSession(): boolean {
    if (!this.session || this.session.status !== 'paused') return false;
    this.session.status = 'active';
    this.running = true;
    this._scheduleNextTurn();
    this.broadcast('council_status', this._statusPayload());
    console.log('[COUNCIL] Resumed');
    return true;
  }

  async stopSession(): Promise<boolean> {
    if (!this.session) return false;
    this._clearTimers();
    await this._fireClosing('manual');
    return true;
  }

  getStatus(): object {
    if (!this.session) return { status: 'inactive' };
    return this._statusPayload();
  }

  // ── Human message ─────────────────────────────────────────────────────────

  async humanMessage(text: string): Promise<void> {
    if (!this.session) return;
    const tokens = countTokens(text);
    this.session.tokenVelocity.humanTokens += tokens;
    this._updateVelocityRatio();

    const turn: CouncilTurn = {
      id:        shortId(),
      role:      'convener', // placeholder role for human turns
      agentName: 'Human (Spark)',
      text:      text.trim(),
      timestamp: new Date().toISOString(),
      isHuman:   true,
    };
    this.session.turns.push(turn);
    this.broadcast('council_turn', turn);

    // Check for Witness commands
    const witnessCmd = text.match(/^Witness:\s+(.+)/i);
    if (witnessCmd) {
      await this.commandWitness(witnessCmd[1].trim());
    }
  }

  // ── Protocol 0.4 — Witness Commands ──────────────────────────────────────

  async commandWitness(command: string): Promise<{ ok: boolean; message: string }> {
    const strikeMatch  = command.match(/^strike\s+([A-Z0-9\-]+)/i);
    const reweightMatch = command.match(/^re-?weight\s+([A-Z0-9\-]+)\s+to\s+(\d+)/i);
    const annotateMatch = command.match(/^annotate\s+([A-Z0-9\-]+)\s+(.+)/i);
    const clearMatch   = command.match(/^clear\s+the\s+field/i);

    let ok      = false;
    let message = '';

    if (strikeMatch) {
      ok      = this.aether.strike(strikeMatch[1]);
      message = ok
        ? `Acknowledged. The Aether is recalibrated. Entry ${strikeMatch[1]} has been struck from the record.`
        : `Entry ${strikeMatch[1]} not found in the Aether.`;
    } else if (reweightMatch) {
      ok      = this.aether.reweight(reweightMatch[1], parseInt(reweightMatch[2], 10));
      message = ok
        ? `Acknowledged. ${reweightMatch[1]} re-weighted to ${reweightMatch[2]}. My interpretation was flawed; your sovereignty over the record is restored.`
        : `Entry ${reweightMatch[1]} not found in the Aether.`;
    } else if (annotateMatch) {
      ok      = this.aether.annotate(annotateMatch[1], annotateMatch[2]);
      message = ok
        ? `Acknowledged. Annotation added to ${annotateMatch[1]}.`
        : `Entry ${annotateMatch[1]} not found in the Aether.`;
    } else if (clearMatch) {
      this.aether.clearField();
      ok      = true;
      message = 'Acknowledged. The field is cleared. Raising similarity threshold for 3 minutes.';
    } else {
      message = `Witness command not recognized: "${command}". Valid: Strike [id], Re-weight [id] to [n], Annotate [id] [note], Clear the Field.`;
    }

    const responseText = `[WITNESS — PROTOCOL 0.4]\n${message}`;
    this._postSystemTurn('witness', responseText);
    return { ok, message };
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  getLastReport(): string | null {
    const dir = join(this.dataDir, 'council', 'reports');
    if (!existsSync(dir)) return null;
    const files = require('fs').readdirSync(dir)
      .filter((f: string) => f.endsWith('.md'))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    return readFileSync(join(dir, files[0]), 'utf-8');
  }

  listReports(): string[] {
    const dir = join(this.dataDir, 'council', 'reports');
    if (!existsSync(dir)) return [];
    return require('fs').readdirSync(dir)
      .filter((f: string) => f.endsWith('.md'))
      .sort()
      .reverse();
  }

  // ── Private: turn cycle ───────────────────────────────────────────────────

  private _scheduleNextTurn(): void {
    this._clearTurnTimer();
    if (!this.running || !this.session || this.session.status !== 'active') return;
    this.turnTimer = setTimeout(() => {
      this._runNextTurn().catch(err => console.error('[COUNCIL] Turn error:', err));
    }, TURN_INTERVAL_MS);
  }

  private async _runNextTurn(): Promise<void> {
    if (!this.running || !this.session || this.session.status !== 'active') return;

    // Ombudsman token velocity check (silent unless triggering pause)
    if (this._checkTokenVelocity()) return; // paused — exit

    const role  = TURN_ORDER[this.turnIndex % TURN_ORDER.length];
    this.turnIndex++;

    const agent = this.agents.get(role);
    if (!agent) {
      this._scheduleNextTurn();
      return;
    }

    const history     = formatHistory(this.session.turns);
    const latestHuman = this._latestHumanText();

    try {
      const text = await agent.generate(history, latestHuman);
      if (text) {
        const turn = this._postAgentTurn(role, agent.displayName, text, agent.color);

        // Witness: search Aether after turn
        if (role === 'witness') {
          this._fireWitnessRecall(text, turn.id).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`[COUNCIL] ${role} generation error:`, err);
    }

    this._scheduleNextTurn();
  }

  private _checkTokenVelocity(): boolean {
    if (!this.session) return false;
    const vel = this.session.tokenVelocity;
    vel.ratio       = vel.aiTokens / Math.max(vel.humanTokens, 1);
    vel.lastChecked = Date.now();

    const humanMsgCount = (this.session.turns ?? []).filter(t => (t as any).isHuman).length;
    if (vel.ratio > TOKEN_VELOCITY_THRESHOLD && humanMsgCount >= TOKEN_VELOCITY_MIN_HUMAN_MSGS) {
      this.pauseSession(
        `Token velocity exceeded threshold (AI:Human ratio = ${vel.ratio.toFixed(1)}:1). Ombudsman invoked.`,
      );
      return true;
    }
    return false;
  }

  private async _fireConvenerTurn(text: string): Promise<void> {
    const convener = this.agents.get('convener');
    if (convener) {
      try {
        const generated = await convener.generate('', text);
        const finalText = generated || text;
        this._postAgentTurn('convener', convener.displayName, finalText, convener.color);
      } catch {
        this._postSystemTurn('convener', text);
      }
    } else {
      this._postSystemTurn('convener', text);
    }
  }

  private async _fireSynthesizerCoherence(): Promise<void> {
    const synth = this.agents.get('synthesizer');
    if (!synth || !this.session) return;
    const history = formatHistory(this.session.turns);
    const prompt  = 'Please provide the Coherence Map: the convergent truths, irreducible fractures, and emergent signal from this deliberation.';
    try {
      const text = await synth.generate(history, prompt);
      if (text) this._postAgentTurn('synthesizer', synth.displayName, `[COHERENCE MAP]\n${text}`, synth.color);
    } catch (err) {
      console.error('[COUNCIL] Synthesizer coherence error:', err);
    }
  }

  private async _fireWitnessAudit(): Promise<void> {
    const witness = this.agents.get('witness');
    if (!witness || !this.session) return;
    const history   = formatHistory(this.session.turns);
    const allAether = this.aether.getAll();
    const prompt    = `Provide the Aether Audit Summary for this session. ${allAether.length} entries are in the record. Highlight the most relevant anchors surfaced during this deliberation.`;
    try {
      const text = await witness.generate(history, prompt);
      if (text) this._postAgentTurn('witness', witness.displayName, `[AETHER AUDIT]\n${text}`, witness.color);
    } catch (err) {
      console.error('[COUNCIL] Witness audit error:', err);
    }
  }

  private async _fireWitnessRecall(turnText: string, triggeredByTurnId: string): Promise<void> {
    if (!this.session) return;
    const results = await this.aether.search(turnText, 3, 5);
    for (const r of results) {
      const recall: WitnessRecall = {
        id:               shortId(),
        memoryId:         r.entry.memory_id,
        anchor:           r.entry.content.slice(0, 120),
        precedent:        r.entry.category,
        resonance:        r.entry.tags.join(', '),
        inquiry:          `Related to: ${r.entry.tags.slice(0, 3).join(', ')}`,
        similarity:       r.score,
        triggeredByTurnId,
      };
      this.session.aetherRecalls.push(recall);
      // Broadcast to sidebar for visual display
      this.broadcast('council_recall', recall);

      // CRITICAL: Also post the recall as a real Witness turn so subsequent agents
      // see it in their conversation history — not just the sidebar
      const anchor = r.entry.content.slice(0, 300);
      const ellipsis = r.entry.content.length > 300 ? '…' : '';
      const recallText = `[AETHER RECALL — ${r.entry.memory_id} | w:${r.entry.integrity_weight}]\nThe Aether holds: ${anchor}${ellipsis}`;
      this._postAgentTurn('witness', ROLE_DISPLAY['witness'], recallText, '#a8c5a0');
    }
  }

  async _fireClosing(reason: 'timer' | 'manual'): Promise<void> {
    if (!this.session) return;
    this._clearTimers();
    this.running         = false;
    this.session.status  = 'closing';
    this.broadcast('council_status', this._statusPayload());

    console.log(`[COUNCIL] Closing session (${reason})`);

    // Convener closes
    await this._fireConvenerTurn(buildProtocolOmega(this.session));

    // Synthesizer coherence map
    await this._fireSynthesizerCoherence();

    // Witness audit
    await this._fireWitnessAudit();

    // Generate report
    const { ReportBuilder } = await import('./reportBuilder');
    const builder = new ReportBuilder(this.dataDir);
    const report  = builder.generate(this.session);
    builder.save(report);
    console.log(`[COUNCIL] Report saved: ${report.sessionId}`);

    // Auto-ingest key session outcomes back into shared Aether for cross-session memory
    // This makes council decisions available to BOTH future council sessions AND companion mode
    const q = this.session.sip.question;
    const baseTag = `council:${report.sessionId}`;
    if (report.emergentSignal && report.emergentSignal.length > 20) {
      await this.memoryRecall.ingest(
        `Council Session ${report.date} — ${report.status}:\nQuestion: ${q}\nEmergent Signal: ${report.emergentSignal}`,
        'Council', 'Relational_Arc', 9,
        ['council', 'decision', report.status.toLowerCase(), baseTag],
      ).catch(() => {});
    }
    for (const truth of report.convergentTruths.slice(0, 3)) {
      await this.memoryRecall.ingest(
        `Council Convergent Truth (${report.date}): ${truth}`,
        'Council', 'Relational_Arc', 8,
        ['council', 'convergent-truth', baseTag],
      ).catch(() => {});
    }

    this.session.status = 'closed';
    this.broadcast('council_status', this._statusPayload());
    this.broadcast('council_report', { sessionId: report.sessionId, markdown: report.markdown });
  }

  // ── Private: turn helpers ─────────────────────────────────────────────────

  private _postAgentTurn(
    role: CouncilRole,
    agentName: string,
    text: string,
    color = '#888888',
  ): CouncilTurn {
    const turn: CouncilTurn = {
      id:        shortId(),
      role,
      agentName,
      text,
      timestamp: new Date().toISOString(),
      color,
    };
    this.session!.turns.push(turn);
    this.session!.tokenVelocity.aiTokens += countTokens(text);
    this._updateVelocityRatio();
    this.broadcast('council_turn', turn);
    return turn;
  }

  private _postSystemTurn(role: CouncilRole, text: string): CouncilTurn {
    return this._postAgentTurn(role, ROLE_DISPLAY[role], text);
  }

  private _latestHumanText(): string {
    if (!this.session) return '';
    for (let i = this.session.turns.length - 1; i >= 0; i--) {
      if (this.session.turns[i].isHuman) return this.session.turns[i].text;
    }
    return this.session.sip.question;
  }

  private _updateVelocityRatio(): void {
    if (!this.session) return;
    const vel = this.session.tokenVelocity;
    vel.ratio = vel.aiTokens / Math.max(vel.humanTokens, 1);
  }

  private _clearTurnTimer(): void {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
  }

  private _clearTimers(): void {
    this._clearTurnTimer();
    if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
  }

  private _statusPayload(): object {
    if (!this.session) return { status: 'inactive' };
    const now            = Date.now();
    const timerRemaining = Math.max(0, Math.round((this.session.expiresAt - now) / 1000));
    return {
      status:          this.session.status,
      sessionId:       this.session.sessionId,
      timerRemaining,
      turnCount:       this.session.turns.length,
      recallCount:     this.session.aetherRecalls.length,
      alertCount:      this.session.ombudsmanAlerts.length,
      tokenVelocity:   this.session.tokenVelocity,
    };
  }
}
