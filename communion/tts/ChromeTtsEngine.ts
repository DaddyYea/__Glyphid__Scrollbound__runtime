import { synthesizeChunk } from '../voice';
import { IncrementalTtsChunker, DEFAULT_TTS_CHUNK_POLICY } from './TtsChunker';
import { TtsEngine, TtsEngineCallbacks, TtsEngineEventHandler, TtsEngineEventMap, TtsEngineEventName } from './TtsEngine';
import { TtsEngineStateSnapshot, TtsHumanRelation, TtsInterruptReason, TtsOutputEvent, TtsSpeakRequest, TtsState, TtsTracePatch } from './TtsTypes';

interface ActiveRequestState {
  requestId: string;
  agentId: string;
  clusterId: string;
  clusterText: string;
  voiceId: string;
  chunker: IncrementalTtsChunker;
  startedAt: number;
  firstApprovedTextAt: number;
  firstChunkQueuedAt: number | null;
  firstAudioAt: number | null;
  queuedChunkCount: number;
  spokenChunkCount: number;
  droppedChunkCount: number;
  chunkLengths: number[];
  emittedStart: boolean;
  closed: boolean;
  requestVersion: number;
  lastError: string | null;
}

export class ChromeTtsEngine implements TtsEngine {
  private state: TtsState = 'idle';
  private active: ActiveRequestState | null = null;
  private initialized = false;
  private readonly handlers = new Map<TtsEngineEventName, Function[]>();
  private readonly callbacks: TtsEngineCallbacks;
  private engineVersion = 0;
  private currentLoopPromise: Promise<void> | null = null;
  private currentLoopToken: number | null = null;
  private currentLoopRequestId: string | null = null;
  private loopSerial = 0;
  private paused = false;
  private lastError: string | null = null;

  constructor(callbacks: TtsEngineCallbacks) {
    this.callbacks = callbacks;
  }

  async init(): Promise<void> {
    this.initialized = true;
  }

  async speak(request: TtsSpeakRequest): Promise<void> {
    if (!this.initialized) await this.init();

    if (this.active && this.active.requestId !== request.requestId) {
      await this.stop('superseded');
    }

    const voice = this.callbacks.resolveVoice(request);
    if (!voice || !voice.enabled) return;

    const chunker = new IncrementalTtsChunker({ ...DEFAULT_TTS_CHUNK_POLICY, ...(request.chunkPolicy || {}) });
    chunker.append(request.text || '');
    if (request.finalText !== false) chunker.close();

    this.active = {
      requestId: request.requestId,
      agentId: request.agentId,
      clusterId: request.clusterId,
      clusterText: request.clusterText || request.text || '',
      voiceId: request.voiceId || voice.voiceId,
      chunker,
      startedAt: Date.now(),
      firstApprovedTextAt: Date.now(),
      firstChunkQueuedAt: null,
      firstAudioAt: null,
      queuedChunkCount: 0,
      spokenChunkCount: 0,
      droppedChunkCount: 0,
      chunkLengths: [],
      emittedStart: false,
      closed: request.finalText !== false,
      requestVersion: ++this.engineVersion,
      lastError: null,
    };
    this.state = 'buffering';
    this.emitEngine('request_created', { requestId: request.requestId, agentId: request.agentId, clusterId: request.clusterId });
    this.trace(request.agentId, {
      kickLoopCalled: false,
      runLoopEntered: false,
      firstDrainReadyCount: 0,
    });
    this.trace(request.agentId, {
      activeRequestId: request.requestId,
      activeClusterId: request.clusterId,
      activeBackend: 'chrome_stream_audio',
      currentVoiceId: this.active.voiceId,
      state: this.state,
      startedAt: this.active.startedAt,
      firstApprovedTextAt: this.active.firstApprovedTextAt,
      ttsRequestCreated: true,
      finalTextLength: (request.text || '').length,
      textChunkedForTts: false,
      ttsChunkCount: 0,
      queuedChunkCount: 0,
      spokenChunkCount: 0,
      droppedChunkCount: 0,
    });
    this.kickLoop();
  }

  async append(requestId: string, appendedText: string): Promise<void> {
    if (!this.active || this.active.requestId !== requestId || !appendedText) return;
    const startedAt = Date.now();
    this.active.chunker.append(appendedText);
    this.active.clusterText = `${this.active.clusterText} ${appendedText}`.trim();
    this.emitEngine('request_appended', { requestId, agentId: this.active.agentId, textLength: appendedText.length });
    this.trace(this.active.agentId, {
      speechAppendApplied: true,
      clusterTargetDerivedFromAppend: true,
      chunkAppendLatencyMs: Date.now() - startedAt,
      newHumanRelationToActiveCluster: 'append',
    });
    this.kickLoop();
  }

  async retarget(requestId: string, replacementText: string, mode: TtsHumanRelation): Promise<void> {
    if (!this.active || this.active.requestId !== requestId) return;
    const oldQueued = this.active.queuedChunkCount;
    const oldTailLength = this.active.chunker.getState().bufferLength;
    const preservedSpokenPrefixLength = this.active.chunkLengths.reduce((sum, len) => sum + len, 0);
    this.active.chunker.replaceTail(replacementText || '');
    this.active.chunker.close();
    this.active.closed = true;
    this.active.clusterText = replacementText || this.active.clusterText;
    this.active.droppedChunkCount += oldQueued;
    this.active.queuedChunkCount = 0;
    this.emitEngine('request_retargeted', { requestId, agentId: this.active.agentId, mode: mode === 'single' ? 'append' : mode });
    this.trace(this.active.agentId, {
      speechRetargetedTail: true,
      newHumanRelationToActiveCluster: mode,
      speechRefineApplied: mode === 'refine',
      speechOverrideApplied: mode === 'override',
      speechReplaceApplied: mode === 'replace',
      clusterTargetDerivedFromAppend: mode === 'append',
      clusterTargetDerivedFromRefine: mode === 'refine',
      preservedSpokenPrefixLength,
      droppedUnsaidTailLength: oldTailLength,
      droppedChunkCount: this.active.droppedChunkCount,
      staleChunksDropped: this.active.droppedChunkCount,
      queuedChunkCount: 0,
    });
    this.kickLoop();
  }

  async close(requestId: string): Promise<void> {
    if (!this.active || this.active.requestId !== requestId) return;
    this.active.chunker.close();
    this.active.closed = true;
    this.kickLoop();
  }

  async stop(reason: TtsInterruptReason = 'explicit_stop'): Promise<void> {
    const active = this.active;
    if (!active) return;
    const stopDecisionAt = Date.now();
    active.requestVersion = ++this.engineVersion;
    active.droppedChunkCount += active.queuedChunkCount;
    active.queuedChunkCount = 0;
    this.state = 'stopping';
    this.callbacks.dispatch({ type: 'speech-stop', agentId: active.agentId, reason, requestId: active.requestId });
    this.emitEngine('interrupted', { requestId: active.requestId, agentId: active.agentId, reason });
    this.trace(active.agentId, {
      state: this.state,
      ttsInterrupted: true,
      interruptedReason: reason,
      playbackFailed: false,
      stopDecisionToSilenceMs: Date.now() - stopDecisionAt,
      droppedChunkCount: active.droppedChunkCount,
      staleChunksDropped: active.droppedChunkCount,
    });
    this.currentLoopToken = null;
    this.currentLoopRequestId = null;
    this.currentLoopPromise = null;
    this.active = null;
    this.state = 'idle';
    this.emitEngine('stopped', { requestId: active.requestId, agentId: active.agentId, reason });
  }

  async pause(): Promise<void> {
    this.paused = true;
    this.state = 'paused';
  }

  async resume(): Promise<void> {
    this.paused = false;
    if (this.active) {
      this.state = 'buffering';
      this.kickLoop();
    } else {
      this.state = 'idle';
    }
  }

  getState(): TtsEngineStateSnapshot {
    return {
      state: this.state,
      activeRequestId: this.active?.requestId || null,
      activeClusterId: this.active?.clusterId || null,
      activeAgentId: this.active?.agentId || null,
      activeClusterText: this.active?.clusterText || null,
      chunkLengths: this.active?.chunkLengths.slice() || [],
      spokenPrefixLength: this.active ? this.active.chunkLengths.reduce((sum, len) => sum + len, 0) : 0,
      queuedChunkCount: this.active?.queuedChunkCount || 0,
      spokenChunkCount: this.active?.spokenChunkCount || 0,
      droppedChunkCount: this.active?.droppedChunkCount || 0,
      currentVoiceId: this.active?.voiceId || null,
      lastError: this.lastError,
    };
  }

  on<K extends TtsEngineEventName>(event: K, handler: TtsEngineEventHandler<K>): void {
    const current = this.handlers.get(event) || [];
    current.push(handler as unknown as Function);
    this.handlers.set(event, current);
  }

  async dispose(): Promise<void> {
    await this.stop('explicit_stop');
  }

  private kickLoop(): void {
    if (this.paused || !this.active) return;
    if (this.currentLoopToken !== null && this.currentLoopRequestId === this.active.requestId) return;
    const token = ++this.loopSerial;
    const requestId = this.active.requestId;
    this.currentLoopToken = token;
    this.currentLoopRequestId = requestId;
    this.trace(this.active.agentId, { kickLoopCalled: true });
    this.currentLoopPromise = this.runLoop(requestId, token).finally(() => {
      if (this.currentLoopToken === token) {
        this.currentLoopToken = null;
        this.currentLoopRequestId = null;
        this.currentLoopPromise = null;
      }
      if (this.active && !this.paused && this.active.requestId === requestId) {
        const state = this.active.chunker.getState();
        if (state.bufferLength > 0 || !state.closed) {
          this.kickLoop();
        }
      }
    });
  }

  private async runLoop(requestId: string, token: number): Promise<void> {
    while (this.active && !this.paused && this.currentLoopToken === token) {
      const active = this.active;
      if (active.requestId !== requestId) return;
      const version = active.requestVersion;
      this.trace(active.agentId, { runLoopEntered: true });
      const ready = active.chunker.drainReady(true);
      this.trace(active.agentId, { firstDrainReadyCount: ready.length });
      if (ready.length === 0) {
        if (active.closed && active.chunker.getState().bufferLength === 0) {
          await this.finishActive(active, version);
        }
        return;
      }

      for (let i = 0; i < ready.length; i += 1) {
        if (!this.active || this.active.requestId !== active.requestId || active.requestVersion !== version || this.paused) return;
        const chunkText = ready[i];
        active.queuedChunkCount += 1;
        if (active.firstChunkQueuedAt === null) active.firstChunkQueuedAt = Date.now();
        this.trace(active.agentId, {
          state: 'buffering',
          queuedChunkCount: active.queuedChunkCount,
          ttsRequestBuilt: true,
          ttsRequestSent: true,
          ttsChunkCount: active.spokenChunkCount + active.queuedChunkCount,
          ttsChunkLengths: [...active.chunkLengths, chunkText.length],
          ttsChunkCharLimit: DEFAULT_TTS_CHUNK_POLICY.maxChars,
          textChunkedForTts: active.spokenChunkCount + active.queuedChunkCount > 1,
          firstChunkQueuedAt: active.firstChunkQueuedAt,
          firstApprovedToFirstChunkMs: active.firstChunkQueuedAt - active.firstApprovedTextAt,
          ttsPlaybackQueued: true,
          playbackQueued: true,
        });
        this.emitEngine('chunk_started', { requestId: active.requestId, agentId: active.agentId, chunkIndex: active.spokenChunkCount + active.queuedChunkCount - 1 });
        try {
          const audio = await synthesizeChunk(chunkText, { voiceId: active.voiceId, enabled: true });
          if (!this.active || this.active.requestId !== active.requestId || active.requestVersion !== version) return;
          if (!active.emittedStart) {
            active.emittedStart = true;
            this.callbacks.dispatch({ type: 'speech-start', agentId: active.agentId, durationMs: 0, requestId: active.requestId });
            this.emitEngine('speak_started', { requestId: active.requestId, agentId: active.agentId });
            this.state = 'speaking';
          }
          const chunkIndex = active.spokenChunkCount;
          this.callbacks.dispatch({
            type: 'speech-chunk',
            agentId: active.agentId,
            requestId: active.requestId,
            audioBase64: audio.toString('base64'),
            audioFormat: 'mp3',
            chunkIndex,
            chunkCount: Math.max(chunkIndex + 1, chunkIndex + active.queuedChunkCount),
            isFinalChunk: false,
          });
          active.queuedChunkCount = Math.max(0, active.queuedChunkCount - 1);
          active.spokenChunkCount += 1;
          active.chunkLengths.push(chunkText.length);
          if (active.firstAudioAt === null) {
            active.firstAudioAt = Date.now();
            this.emitEngine('first_audio', { requestId: active.requestId, agentId: active.agentId });
          }
          this.trace(active.agentId, {
            state: this.state,
            spokenChunkCount: active.spokenChunkCount,
            queuedChunkCount: active.queuedChunkCount,
            firstAudioAt: active.firstAudioAt,
            firstChunkToFirstAudioMs: active.firstChunkQueuedAt && active.firstAudioAt ? active.firstAudioAt - active.firstChunkQueuedAt : null,
            totalFirstAudioLatencyMs: active.firstAudioAt - active.firstApprovedTextAt,
            firstAudioLatencyMs: active.firstAudioAt - active.firstApprovedTextAt,
            ttsResponseReceived: true,
            playbackQueued: true,
          });
          this.emitEngine('chunk_finished', { requestId: active.requestId, agentId: active.agentId, chunkIndex });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this.lastError = error;
          this.state = 'error';
          this.trace(active.agentId, {
            state: this.state,
            playbackFailed: true,
            blockReason: error,
            ttsPlaybackFailed: true,
          });
          this.currentLoopToken = null;
          this.currentLoopRequestId = null;
          this.currentLoopPromise = null;
          this.callbacks.dispatch({ type: 'speech-stop', agentId: active.agentId, reason: 'error', requestId: active.requestId });
          this.emitEngine('error', { requestId: active.requestId, agentId: active.agentId, error });
          this.active = null;
          return;
        }
      }
    }
  }

  private async finishActive(active: ActiveRequestState, version: number): Promise<void> {
    if (!this.active || this.active.requestId !== active.requestId || active.requestVersion !== version) return;
    const durationMs = Math.max(1000, (Math.max(1, active.clusterText.length) / 750) * 60000);
    this.callbacks.dispatch({
      type: 'speech-end',
      agentId: active.agentId,
      requestId: active.requestId,
      audioBase64: '',
      audioFormat: 'mp3',
      durationMs,
    });
    const finishedAt = Date.now();
    this.trace(active.agentId, {
      state: 'idle',
      finishedAt,
      playbackQueued: true,
      ttsPlaybackQueued: true,
          playbackQueued: true,
      ttsPlaybackFinished: false,
    });
    this.emitEngine('speak_finished', { requestId: active.requestId, agentId: active.agentId });
    this.emitEngine('stopped', { requestId: active.requestId, agentId: active.agentId, reason: 'finished' });
    this.active = null;
    this.state = 'idle';
  }

  private emitEngine<K extends TtsEngineEventName>(event: K, payload: TtsEngineEventMap[K]): void {
    const handlers = this.handlers.get(event) || [];
    for (const handler of handlers) {
      try {
        (handler as TtsEngineEventHandler<K>)(payload);
      } catch {
        // ignore
      }
    }
  }

  private trace(agentId: string, patch: TtsTracePatch): void {
    this.callbacks.trace(agentId, patch);
  }

}


