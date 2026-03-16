import { TtsEngineStateSnapshot, TtsHumanRelation, TtsInterruptReason, TtsOutputEvent, TtsSpeakRequest, TtsState, TtsTracePatch } from './TtsTypes';

export interface TtsEngineEventMap {
  request_created: { requestId: string; agentId: string; clusterId: string };
  speak_started: { requestId: string; agentId: string };
  first_audio: { requestId: string; agentId: string };
  chunk_started: { requestId: string; agentId: string; chunkIndex: number };
  chunk_finished: { requestId: string; agentId: string; chunkIndex: number };
  request_retargeted: { requestId: string; agentId: string; mode: 'append' | 'refine' | 'override' | 'replace' };
  request_appended: { requestId: string; agentId: string; textLength: number };
  speak_finished: { requestId: string; agentId: string };
  stopped: { requestId: string | null; agentId: string | null; reason: TtsInterruptReason | 'finished' | 'explicit_stop' | null };
  interrupted: { requestId: string; agentId: string; reason: TtsInterruptReason };
  error: { requestId: string | null; agentId: string | null; error: string };
}

export type TtsEngineEventName = keyof TtsEngineEventMap;
export type TtsEngineEventHandler<K extends TtsEngineEventName> = (payload: TtsEngineEventMap[K]) => void;

export interface TtsEngine {
  init(): Promise<void>;
  speak(request: TtsSpeakRequest): Promise<void>;
  append(requestId: string, appendedText: string): Promise<void>;
  retarget(requestId: string, replacementText: string, mode: TtsHumanRelation): Promise<void>;
  close(requestId: string): Promise<void>;
  stop(reason?: TtsInterruptReason): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getState(): TtsEngineStateSnapshot;
  on<K extends TtsEngineEventName>(event: K, handler: TtsEngineEventHandler<K>): void;
  dispose(): Promise<void>;
}

export interface TtsEngineCallbacks {
  dispatch(event: TtsOutputEvent): void;
  trace(agentId: string, patch: TtsTracePatch): void;
  resolveVoice(request: TtsSpeakRequest): { voiceId: string; enabled: boolean } | null;
}
