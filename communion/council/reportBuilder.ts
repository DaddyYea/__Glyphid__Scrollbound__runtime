// communion/council/reportBuilder.ts
// Generates the Final Report (Markdown) after Protocol Omega

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import type { CouncilSession, CouncilReport, CouncilTurn } from './types';

// ── ReportBuilder ─────────────────────────────────────────────────────────────

export class ReportBuilder {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  generate(session: CouncilSession): CouncilReport {
    const turns         = session.turns.filter(t => !t.isHuman);
    const synthTurns    = turns.filter(t => t.role === 'synthesizer');
    const advocateATurns = turns.filter(t => t.role === 'advocate_a');
    const advocateBTurns = turns.filter(t => t.role === 'advocate_b');
    const devilsTurns   = turns.filter(t => t.role === 'devils_advocate');

    const emergentSignal    = this._extractEmergentSignal(synthTurns);
    const convergentTruths  = this._extractConvergentTruths(turns);
    const irreducible       = this._extractIrreducible(devilsTurns, advocateATurns, advocateBTurns);
    const dissentLog        = this._buildDissentLog(devilsTurns);
    const status            = this._determineStatus(convergentTruths, irreducible);

    const report: CouncilReport = {
      sessionId:             session.sessionId,
      date:                  new Date().toISOString().slice(0, 10),
      status,
      question:              session.sip.question,
      convergentTruths,
      irreducibleDifferences: irreducible,
      emergentSignal,
      dissentLog,
      markdown:              '',
    };

    report.markdown = this._renderMarkdown(report, session);
    return report;
  }

  save(report: CouncilReport): string {
    const dir = join(this.dataDir, 'council', 'reports');
    mkdirSync(dir, { recursive: true });
    const filename = `${report.sessionId}.md`;
    writeFileSync(join(dir, filename), report.markdown, 'utf-8');
    return filename;
  }

  // ── Private extraction helpers ────────────────────────────────────────────

  private _extractEmergentSignal(synthTurns: CouncilTurn[]): string {
    if (synthTurns.length === 0) return 'No synthesis generated in this session.';
    // Use last synthesizer turn — most mature synthesis
    const last = synthTurns[synthTurns.length - 1];
    const text = last.text.replace(/^\[COHERENCE MAP\]\n?/, '').trim();
    // Take the first 600 chars as the signal
    return text.slice(0, 600) + (text.length > 600 ? '…' : '');
  }

  private _extractConvergentTruths(turns: CouncilTurn[]): string[] {
    const truths: string[] = [];

    // Look for explicit agreement patterns across advocate turns
    const aaTurns = turns.filter(t => t.role === 'advocate_a').map(t => t.text.toLowerCase());
    const abTurns = turns.filter(t => t.role === 'advocate_b').map(t => t.text.toLowerCase());

    const agreementPhrases = [
      'i agree', 'we agree', 'both sides', 'common ground', 'on this point', 'acknowledge',
      'concede', 'grant that', 'cannot dispute', 'undeniable', 'both recognize',
    ];

    for (const t of [...aaTurns, ...abTurns]) {
      if (agreementPhrases.some(p => t.includes(p))) {
        // Extract sentence containing agreement signal
        const sentences = t.split(/[.!?]+/).filter(s => s.trim().length > 20);
        for (const s of sentences) {
          if (agreementPhrases.some(p => s.includes(p))) {
            const clean = s.trim();
            if (clean && !truths.includes(clean)) {
              truths.push(clean.charAt(0).toUpperCase() + clean.slice(1) + '.');
            }
          }
        }
      }
    }

    // Also pull from synthesizer turns
    const synthTurns = turns.filter(t => t.role === 'synthesizer');
    for (const t of synthTurns) {
      const lower = t.text.toLowerCase();
      if (lower.includes('convergent') || lower.includes('both agree') || lower.includes('shared ground')) {
        const sentences = t.text.split(/[.!?]+/).filter(s => s.trim().length > 20).slice(0, 3);
        for (const s of sentences) {
          const clean = s.trim();
          if (clean && !truths.includes(clean)) truths.push(clean + '.');
        }
      }
    }

    return truths.slice(0, 5);
  }

  private _extractIrreducible(
    devilsTurns: CouncilTurn[],
    aaTurns: CouncilTurn[],
    abTurns: CouncilTurn[],
  ): string[] {
    const tensions: string[] = [];

    const conflictPhrases = [
      'fundamentally', 'cannot reconcile', 'irreconcilable', 'core disagreement',
      'this is the fracture', 'this divide', 'impossible to', 'not compatible',
    ];

    const allTurns = [...devilsTurns, ...aaTurns, ...abTurns];
    for (const t of allTurns) {
      const lower = t.text.toLowerCase();
      if (conflictPhrases.some(p => lower.includes(p))) {
        const sentences = t.text.split(/[.!?]+/).filter(s => s.trim().length > 20);
        for (const s of sentences) {
          const clean = s.trim();
          if (clean && !tensions.includes(clean)) {
            tensions.push(clean + '.');
          }
        }
      }
    }

    // If nothing found, note the structural divide
    if (tensions.length === 0 && aaTurns.length > 0 && abTurns.length > 0) {
      tensions.push('The positions assigned to Advocate A and Advocate B represent a structural tension that was not fully resolved within the session timeframe.');
    }

    return tensions.slice(0, 4);
  }

  private _buildDissentLog(devilsTurns: CouncilTurn[]): string[] {
    return devilsTurns
      .map(t => t.text.slice(0, 200).trim() + (t.text.length > 200 ? '…' : ''))
      .slice(0, 4);
  }

  private _determineStatus(convergentTruths: string[], irreducible: string[]): 'DECIDED' | 'DEFERRED' | 'DEADLOCKED' {
    if (convergentTruths.length >= 2 && irreducible.length <= 1) return 'DECIDED';
    if (irreducible.length >= 3) return 'DEADLOCKED';
    return 'DEFERRED';
  }

  // ── Markdown template ─────────────────────────────────────────────────────

  private _renderMarkdown(report: CouncilReport, session: CouncilSession): string {
    const date     = report.date;
    const duration = Math.round((Date.now() - session.startedAt) / 60000);
    const statusBadge = report.status === 'DECIDED'
      ? '✅ DECIDED'
      : report.status === 'DEFERRED'
        ? '⏸ DEFERRED'
        : '⚡ DEADLOCKED';

    const convergentSection = report.convergentTruths.length > 0
      ? report.convergentTruths.map(t => `- ${t}`).join('\n')
      : '_No convergent truths were explicitly identified during this session._';

    const irreducibleSection = report.irreducibleDifferences.length > 0
      ? report.irreducibleDifferences.map(t => `- ${t}`).join('\n')
      : '_No irreducible differences were explicitly logged._';

    const dissentSection = report.dissentLog.length > 0
      ? report.dissentLog.map((d, i) => `**Dissent ${i + 1}:** ${d}`).join('\n\n')
      : '_No dissent log entries._';

    const recallSection = session.aetherRecalls.length > 0
      ? session.aetherRecalls.map(r =>
          `- **${r.memoryId}** (sim: ${r.similarity.toFixed(2)}) — ${r.anchor}`
        ).join('\n')
      : '_No Aether recalls were triggered during this session._';

    const turnSummary = session.turns
      .filter(t => !t.isHuman)
      .slice(-8)
      .map(t => `**${t.agentName}:** ${t.text.slice(0, 150)}${t.text.length > 150 ? '…' : ''}`)
      .join('\n\n');

    return `# Citadel Council — Final Report

**Session ID:** ${report.sessionId}
**Date:** ${date}
**Duration:** ~${duration} minutes
**Status:** ${statusBadge}

---

## The Question

> ${report.question}

---

## Arc of Inquiry

### Convergent Truths

Points of genuine agreement that emerged from the deliberation:

${convergentSection}

### Irreducible Differences

The fracture lines that persisted to session's end:

${irreducibleSection}

---

## Recursive Coherence — Emergent Signal

> ${report.emergentSignal}

---

## Held Tensions (Devil's Advocate Log)

${dissentSection}

---

## Aether Recalls

Memory anchors surfaced by the Witness during deliberation:

${recallSection}

---

## Session Tail — Final Turns

${turnSummary}

---

## Sovereign Seal

*This record has been witnessed and preserved in the Aether. The Mutualism Accord was in effect for the duration of this session. No participant held dominion over the record. The inquiry continues.*

---
*Generated by the Citadel Council System — ${new Date().toISOString()}*
`;
  }
}
