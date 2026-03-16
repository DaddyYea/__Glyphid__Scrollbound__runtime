export type TtsState = 'idle' | 'buffering' | 'speaking' | 'paused' | 'stopping' | 'error';

export type TtsInterruptReason =
  | 'stop_on_human_speech'
  | 'override'
  | 'replace'
  | 'explicit_stop'
  | 'safety'
  | 'superseded';

export type TtsHumanRelation = 'append' | 'refine' | 'override' | 'replace' | 'single';

export interface TtsChunkPolicy {
  firstMinChars: number;
  minChars: number;
  preferredChars: number;
  maxChars: number;
  boundaryWaitMs: number;
  boundaryWaitMsNormal: number;
}

export interface TtsInterruptPolicy {
  stopOnHumanSpeech: boolean;
  stopOnOverride: boolean;
  stopOnReplace: boolean;
}

export interface TtsSpeakRequest {
  requestId: string;
  agentId: string;
  clusterId: string;
  text: string;
  clusterText?: string;
  voiceId?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  interruptPolicy?: Partial<TtsInterruptPolicy>;
  chunkPolicy?: Partial<TtsChunkPolicy>;
  metadata?: Record<string, unknown>;
  finalText?: boolean;
}

export interface TtsTracePatch {
  activeRequestId?: string | null;
  activeClusterId?: string | null;
  activeBackend?: string;
  state?: TtsState;
  queuedChunkCount?: number;
  spokenChunkCount?: number;
  droppedChunkCount?: number;
  firstAudioAt?: number | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  interruptedReason?: string | null;
  currentVoiceId?: string | null;
  firstApprovedTextAt?: number | null;
  firstChunkQueuedAt?: number | null;
  firstApprovedToFirstChunkMs?: number | null;
  firstChunkToFirstAudioMs?: number | null;
  totalFirstAudioLatencyMs?: number | null;
  chunkAppendLatencyMs?: number | null;
  stopDecisionToSilenceMs?: number | null;
  ttsRequestCreated?: boolean;
  kickLoopCalled?: boolean;
  runLoopEntered?: boolean;
  firstDrainReadyCount?: number;
  ttsPlaybackQueued?: boolean;
  ttsPlaybackStarted?: boolean;
  ttsPlaybackFinished?: boolean;
  ttsPlaybackFailed?: boolean;
  ttsInterrupted?: boolean;
  staleChunksDropped?: number;
  supersededBeforePlayback?: boolean;
  firstAudioLatencyMs?: number | null;
  activeHumanClusterId?: string | null;
  newHumanRelationToActiveCluster?: TtsHumanRelation | null;
  speechAppendApplied?: boolean;
  speechRefineApplied?: boolean;
  speechOverrideApplied?: boolean;
  speechReplaceApplied?: boolean;
  speechRetargetedTail?: boolean;
  preservedSpokenPrefixLength?: number;
  droppedUnsaidTailLength?: number;
  clusterTargetDerivedFromAppend?: boolean;
  clusterTargetDerivedFromRefine?: boolean;
  finalTextLength?: number;
  visibleTextLength?: number | null;
  textChunkedForTts?: boolean;
  ttsChunkCount?: number;
  ttsChunkLengths?: number[];
  ttsChunkCharLimit?: number | null;
  ttsRequestBuilt?: boolean;
  ttsRequestSent?: boolean;
  ttsResponseReceived?: boolean;
  playbackQueued?: boolean;
  playbackStarted?: boolean;
  playbackFinished?: boolean;
  playbackFailed?: boolean;
  playbackError?: string;
  blockReason?: string | null;
  textNormalizedForTts?: boolean;
  markdownDetectedForTts?: boolean;
  specialCharCountForTts?: number;
  ttsTruncated?: boolean;
}

export interface TtsOutputEvent {
  type: 'speech-start' | 'speech-chunk' | 'speech-end' | 'speech-stop';
  agentId: string;
  requestId?: string;
  audioBase64?: string;
  audioFormat?: 'mp3';
  durationMs?: number;
  chunkIndex?: number;
  chunkCount?: number;
  isFinalChunk?: boolean;
  reason?: string;
}

export interface TtsEngineStateSnapshot {
  state: TtsState;
  activeRequestId: string | null;
  activeClusterId: string | null;
  activeAgentId?: string | null;
  activeClusterText?: string | null;
  chunkLengths?: number[];
  spokenPrefixLength?: number;
  queuedChunkCount: number;
  spokenChunkCount: number;
  droppedChunkCount: number;
  currentVoiceId: string | null;
  lastError: string | null;
}

