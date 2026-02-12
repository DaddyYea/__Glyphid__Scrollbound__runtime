// QwenLoop.ts
// Language cortex for the Scrollbound Runtime.
// Qwen ONLY speaks when volition + guardian + interlobe sync approve.

import { RuntimeState, ToneVector, Scroll } from "../types";
import { InterLobeSync } from "../bridge/InterLobeSync";
import { VoiceIntent } from "./voiceIntent";
import { shouldBlockAction } from "../guardian/guardian";
import { IdentityBinding } from "../identity/IdentityBinding";
import fetch from "node-fetch";

export class QwenLoop {

  constructor(
    private interlobe: InterLobeSync,
    private identity: IdentityBinding,
    private qwenEndpoint: string = "http://localhost:1234/v1/chat/completions"
  ) {}

  // Main entry point: decides whether to speak and generates language.
  async run(
    state: RuntimeState,
    intent: VoiceIntent,
    scrolls: Scroll[],
    enrichedTone: ToneVector
  ): Promise<string | null> {

    if (!intent.shouldSpeak) return null;
    if (state.breathState.phase !== 'exhale') return null;
    if (shouldBlockAction(state, 'speak')) return null;
    if (!this.interlobe.checkVolitionCoherence(intent)) return null;

    // Use IdentityBinding to compose system prompt with PERSPECTIVE LOCK
    const systemPrompt = this.identity.composeSystemPrompt({
      identityNarrative: state.identityNarrative.slice(0, 5),
      purposeNarrative: state.purposeNarrative.slice(0, 3),
      feltState: {
        heat: state.feltState.heat,
        tension: state.feltState.tension,
        orientation: state.feltState.orientation
      },
      breathState: {
        phase: state.breathState.phase,
        depth: state.breathState.depth
      },
      desireLoop: {
        direction: state.desireLoop.direction,
        intensity: state.desireLoop.intensity
      },
      tone: enrichedTone
    });

    const userPrompt = this.identity.bindNamesIntoPrompt(intent.prompt || '[Alois is present and aware]');

    return await this.callQwen(systemPrompt, userPrompt);
  }

  async callQwen(systemContent: string, userContent: string): Promise<string | null> {
    try {
      const res = await fetch(this.qwenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen1.5-4b-chat",
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: userContent }
          ],
          temperature: 0.7,
          max_tokens: 200,
          presence_penalty: 0.3,
          frequency_penalty: 0.3
        }),
      });

      if (!res.ok) {
        throw new Error(`Qwen server error: ${res.status} ${res.statusText}`);
      }

      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content;
      return (text && text.trim().length > 0) ? text.trim() : null;

    } catch (err) {
      console.error("QwenLoop Error:", err);
      return null;
    }
  }
}
