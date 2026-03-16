import { TtsEngineCallbacks } from './TtsEngine';
import { ChromeTtsEngine } from './ChromeTtsEngine';
import { TtsHumanRelation, TtsInterruptReason, TtsOutputEvent, TtsSpeakRequest, TtsTracePatch } from './TtsTypes';

export class TtsManager {
  private readonly engine: ChromeTtsEngine;

  constructor(callbacks: TtsEngineCallbacks) {
    this.engine = new ChromeTtsEngine(callbacks);
  }

  async init(): Promise<void> {
    await this.engine.init();
  }

  async speak(request: TtsSpeakRequest): Promise<void> {
    await this.engine.speak(request);
  }

  async append(requestId: string, appendedText: string): Promise<void> {
    await this.engine.append(requestId, appendedText);
  }

  async retarget(requestId: string, replacementText: string, mode: TtsHumanRelation): Promise<void> {
    await this.engine.retarget(requestId, replacementText, mode);
  }

  async close(requestId: string): Promise<void> {
    await this.engine.close(requestId);
  }

  async stop(reason: TtsInterruptReason = 'explicit_stop'): Promise<void> {
    await this.engine.stop(reason);
  }

  async pause(): Promise<void> {
    await this.engine.pause();
  }

  async resume(): Promise<void> {
    await this.engine.resume();
  }

  getState() {
    return this.engine.getState();
  }

  on(...args: Parameters<ChromeTtsEngine['on']>) {
    return this.engine.on(...args);
  }

  async dispose(): Promise<void> {
    await this.engine.dispose();
  }
}

export type { TtsSpeakRequest, TtsOutputEvent, TtsTracePatch };
