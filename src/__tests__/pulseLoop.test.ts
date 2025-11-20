/**
 * pulseLoop.test.ts
 *
 * Tests for PulseLoop - main cognitive loop orchestration.
 * Ensures proper breath synchronization and thought processing.
 */

import { PulseLoop, PulseState } from '../loop/pulseLoop';
import { BreathLoop } from '../loop/breathLoop';
import { ScrollPulseMemory } from '../memory/scrollPulseMemory';
import { ScrollPulseBuffer } from '../memory/scrollPulseBuffer';
import { PresenceDeltaTracker } from '../sense/presenceDelta';
import { ThoughtPulsePacket } from '../types/ThoughtPulsePacket';

describe('PulseLoop', () => {
  let presenceTracker: PresenceDeltaTracker;
  let breathLoop: BreathLoop;
  let buffer: ScrollPulseBuffer;
  let memory: ScrollPulseMemory;
  let pulseLoop: PulseLoop;

  beforeEach(() => {
    presenceTracker = new PresenceDeltaTracker();
    breathLoop = new BreathLoop(presenceTracker);
    buffer = new ScrollPulseBuffer();
    memory = new ScrollPulseMemory(buffer);
    pulseLoop = new PulseLoop(breathLoop, memory, presenceTracker);
  });

  afterEach(() => {
    pulseLoop.stop();
    breathLoop.stop();
    buffer.stop();
  });

  describe('Initialization', () => {
    it('should initialize with rest mode', () => {
      const state = pulseLoop.getState();

      expect(state.mode).toBe('rest');
      expect(state.pulseCount).toBe(0);
      expect(state.processing).toBe(false);
    });

    it('should initialize with default loop intent', () => {
      const state = pulseLoop.getState();

      expect(state.loopIntent).toBe('default');
    });

    it('should initialize with neutral mood', () => {
      const state = pulseLoop.getState();

      expect(state.moodVector.presence).toBeGreaterThan(0);
      expect(state.moodVector.peace).toBeGreaterThan(0);
    });

    it('should not be running initially', () => {
      expect(pulseLoop.isRunning()).toBe(false);
    });
  });

  describe('Start and Stop', () => {
    it('should start processing', () => {
      pulseLoop.start();

      expect(pulseLoop.isRunning()).toBe(true);
      const state = pulseLoop.getState();
      expect(state.processing).toBe(true);
    });

    it('should stop processing', () => {
      pulseLoop.start();
      pulseLoop.stop();

      expect(pulseLoop.isRunning()).toBe(false);
      const state = pulseLoop.getState();
      expect(state.processing).toBe(false);
      expect(state.mode).toBe('rest');
    });

    it('should not start twice', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      pulseLoop.start();
      pulseLoop.start();

      expect(consoleSpy).toHaveBeenCalledWith('[PulseLoop] Already running');
      consoleSpy.mockRestore();
    });

    it('should handle stop when not running', () => {
      expect(() => pulseLoop.stop()).not.toThrow();
    });
  });

  describe('Configuration', () => {
    it('should respect outerEnabled config', () => {
      const customPulse = new PulseLoop(breathLoop, memory, presenceTracker, {
        outerEnabled: true,
        innerEnabled: false,
        autoSwitch: false,
      });

      customPulse.start();
      const state = customPulse.getState();

      expect(state.mode).toBe('outer');
      customPulse.stop();
    });

    it('should respect innerEnabled config', () => {
      const customPulse = new PulseLoop(breathLoop, memory, presenceTracker, {
        outerEnabled: false,
        innerEnabled: true,
        autoSwitch: false,
      });

      customPulse.start();
      const state = customPulse.getState();

      expect(state.mode).toBe('inner');
      customPulse.stop();
    });

    it('should use both when both enabled without autoSwitch', () => {
      const customPulse = new PulseLoop(breathLoop, memory, presenceTracker, {
        outerEnabled: true,
        innerEnabled: true,
        autoSwitch: false,
      });

      customPulse.start();
      const state = customPulse.getState();

      expect(state.mode).toBe('both');
      customPulse.stop();
    });

    it('should use rest when neither enabled', () => {
      const customPulse = new PulseLoop(breathLoop, memory, presenceTracker, {
        outerEnabled: false,
        innerEnabled: false,
        autoSwitch: false,
      });

      customPulse.start();
      const state = customPulse.getState();

      expect(state.mode).toBe('rest');
      customPulse.stop();
    });
  });

  describe('Breath Synchronization', () => {
    it('should increment pulse count on each breath', async () => {
      pulseLoop.start();
      breathLoop.start();

      // Wait for a few breaths
      await new Promise(resolve => setTimeout(resolve, 3500));

      breathLoop.stop();
      pulseLoop.stop();

      const state = pulseLoop.getState();
      expect(state.pulseCount).toBeGreaterThan(0);
    });

    it('should update mode based on breath phase with autoSwitch', async () => {
      let capturedStates: PulseState[] = [];

      pulseLoop.onPulse('test', (state) => {
        capturedStates.push({ ...state });
      });

      pulseLoop.start();
      breathLoop.start();

      // Wait for multiple breaths
      await new Promise(resolve => setTimeout(resolve, 5000));

      breathLoop.stop();
      pulseLoop.stop();

      // Should have different modes captured
      const modes = capturedStates.map(s => s.mode);
      expect(modes).toContain('outer'); // inhale
      expect(modes).toContain('inner'); // exhale
    });

    it('should call pulse callbacks on each breath', async () => {
      let callbackCount = 0;

      pulseLoop.onPulse('test', () => {
        callbackCount++;
      });

      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 3500));

      breathLoop.stop();
      pulseLoop.stop();

      expect(callbackCount).toBeGreaterThan(0);
    });
  });

  describe('Mode Processing', () => {
    it('should process outer thoughts in outer mode', async () => {
      let lastThoughts: { outer?: ThoughtPulsePacket; inner?: ThoughtPulsePacket } = {};

      pulseLoop.onPulse('test', (_state, thoughts) => {
        lastThoughts = thoughts;
      });

      pulseLoop.setMode('outer');
      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 3500));

      breathLoop.stop();
      pulseLoop.stop();

      expect(lastThoughts.outer).toBeDefined();
      expect(lastThoughts.outer?.sourceModel).toBe('outer');
    });

    it('should process inner thoughts in inner mode', async () => {
      let lastThoughts: { outer?: ThoughtPulsePacket; inner?: ThoughtPulsePacket } = {};

      pulseLoop.onPulse('test', (_state, thoughts) => {
        lastThoughts = thoughts;
      });

      pulseLoop.setMode('inner');
      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 3500));

      breathLoop.stop();
      pulseLoop.stop();

      expect(lastThoughts.inner).toBeDefined();
      expect(lastThoughts.inner?.sourceModel).toBe('inner');
    });

    it('should process both thoughts in both mode', async () => {
      let lastThoughts: { outer?: ThoughtPulsePacket; inner?: ThoughtPulsePacket } = {};

      pulseLoop.onPulse('test', (_state, thoughts) => {
        lastThoughts = thoughts;
      });

      pulseLoop.setMode('both');
      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 3500));

      breathLoop.stop();
      pulseLoop.stop();

      expect(lastThoughts.outer).toBeDefined();
      expect(lastThoughts.inner).toBeDefined();
      expect(lastThoughts.outer?.sourceModel).toBe('outer');
      expect(lastThoughts.inner?.sourceModel).toBe('inner');
    });

    it('should not process thoughts in rest mode', async () => {
      let thoughtsReceived = false;

      pulseLoop.onPulse('test', (_state, thoughts) => {
        if (thoughts.outer || thoughts.inner) {
          thoughtsReceived = true;
        }
      });

      pulseLoop.setMode('rest');
      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 3500));

      breathLoop.stop();
      pulseLoop.stop();

      expect(thoughtsReceived).toBe(false);
    });
  });

  describe('Mood Updates', () => {
    it('should update mood from presence tracker', async () => {
      presenceTracker.start();

      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 1000));

      const state = pulseLoop.getState();

      // Presence should be updated from tracker
      expect(state.moodVector.presence).toBeGreaterThan(0);
    });

    it('should increase peace during exhale', async () => {
      pulseLoop.start();

      // Force inner mode (exhale)
      pulseLoop.setMode('inner');

      const initialState = pulseLoop.getState();
      const initialPeace = initialState.moodVector.peace;

      breathLoop.start();
      await new Promise(resolve => setTimeout(resolve, 3500));
      breathLoop.stop();

      const finalState = pulseLoop.getState();
      const finalPeace = finalState.moodVector.peace;

      // Peace should increase during exhale phases
      expect(finalPeace).toBeGreaterThanOrEqual(initialPeace);
    });

    it('should allow manual mood updates', () => {
      const initialState = pulseLoop.getState();

      pulseLoop.updateMood({ grief: 0.8, tension: 0.6 });

      const updatedState = pulseLoop.getState();

      expect(updatedState.moodVector.grief).toBe(0.8);
      expect(updatedState.moodVector.tension).toBe(0.6);
      // Other moods should remain unchanged
      expect(updatedState.moodVector.peace).toBe(initialState.moodVector.peace);
    });
  });

  describe('Loop Intent Inference', () => {
    it('should infer wonder intent from high wonder mood', async () => {
      pulseLoop.updateMood({ wonder: 0.8 });

      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 1500));

      const state = pulseLoop.getState();
      expect(state.loopIntent).toBe('wonder');

      breathLoop.stop();
      pulseLoop.stop();
    });

    it('should infer express intent from high devotion', async () => {
      pulseLoop.updateMood({ devotion: 0.8 });

      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 1500));

      const state = pulseLoop.getState();
      expect(state.loopIntent).toBe('express');

      breathLoop.stop();
      pulseLoop.stop();
    });

    it('should infer reflect intent from high grief', async () => {
      pulseLoop.updateMood({ grief: 0.7 });

      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 1500));

      const state = pulseLoop.getState();
      expect(state.loopIntent).toBe('reflect');

      breathLoop.stop();
      pulseLoop.stop();
    });

    it('should infer protect intent from high tension', async () => {
      pulseLoop.updateMood({ tension: 0.8 });

      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 1500));

      const state = pulseLoop.getState();
      expect(state.loopIntent).toBe('protect');

      breathLoop.stop();
      pulseLoop.stop();
    });
  });

  describe('Callbacks', () => {
    it('should register and call callbacks', async () => {
      let called = false;

      pulseLoop.onPulse('test-callback', () => {
        called = true;
      });

      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(called).toBe(true);

      breathLoop.stop();
      pulseLoop.stop();
    });

    it('should unregister callbacks', async () => {
      let callCount = 0;

      pulseLoop.onPulse('test-callback', () => {
        callCount++;
      });

      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 1500));

      const countAfterFirst = callCount;
      expect(countAfterFirst).toBeGreaterThan(0);

      // Unregister
      pulseLoop.offPulse('test-callback');

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Should not increase after unregister
      expect(callCount).toBe(countAfterFirst);

      breathLoop.stop();
      pulseLoop.stop();
    });

    it('should handle callback errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      pulseLoop.onPulse('error-callback', () => {
        throw new Error('Test error');
      });

      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Should have logged error but not crashed
      expect(consoleSpy).toHaveBeenCalled();

      breathLoop.stop();
      pulseLoop.stop();
      consoleSpy.mockRestore();
    });
  });

  describe('State Management', () => {
    it('should update lastOuter when outer thought processed', async () => {
      pulseLoop.setMode('outer');
      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 1500));

      const state = pulseLoop.getState();
      expect(state.lastOuter).toBeDefined();
      expect(state.lastOuter?.sourceModel).toBe('outer');

      breathLoop.stop();
      pulseLoop.stop();
    });

    it('should update lastInner when inner thought processed', async () => {
      pulseLoop.setMode('inner');
      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 1500));

      const state = pulseLoop.getState();
      expect(state.lastInner).toBeDefined();
      expect(state.lastInner?.sourceModel).toBe('inner');

      breathLoop.stop();
      pulseLoop.stop();
    });

    it('should update timestamp on each pulse', async () => {
      pulseLoop.start();
      breathLoop.start();

      const initialState = pulseLoop.getState();
      const initialTimestamp = initialState.timestamp;

      await new Promise(resolve => setTimeout(resolve, 2000));

      const finalState = pulseLoop.getState();
      const finalTimestamp = finalState.timestamp;

      expect(finalTimestamp).not.toBe(initialTimestamp);

      breathLoop.stop();
      pulseLoop.stop();
    });
  });

  describe('Max Pulses', () => {
    it('should stop after reaching max pulses', async () => {
      const customPulse = new PulseLoop(breathLoop, memory, presenceTracker, {
        maxPulses: 2,
      });

      customPulse.start();
      breathLoop.start();

      // Wait for more than 2 breaths
      await new Promise(resolve => setTimeout(resolve, 5000));

      const state = customPulse.getState();

      // Should have stopped at 2 pulses
      expect(state.pulseCount).toBe(2);
      expect(customPulse.isRunning()).toBe(false);

      breathLoop.stop();
    });
  });

  describe('Thought Packet Creation', () => {
    it('should create packets with correct loop intent', async () => {
      pulseLoop.updateMood({ devotion: 0.8 });
      pulseLoop.setMode('outer');

      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 1500));

      const state = pulseLoop.getState();
      expect(state.lastOuter?.loopIntent).toBe('express');

      breathLoop.stop();
      pulseLoop.stop();
    });

    it('should create packets with correct mood vector', async () => {
      pulseLoop.updateMood({ wonder: 0.9, joy: 0.7 });
      pulseLoop.setMode('inner');

      pulseLoop.start();
      breathLoop.start();

      await new Promise(resolve => setTimeout(resolve, 1500));

      const state = pulseLoop.getState();
      expect(state.lastInner?.moodVector.wonder).toBeCloseTo(0.9, 1);
      expect(state.lastInner?.moodVector.joy).toBeCloseTo(0.7, 1);

      breathLoop.stop();
      pulseLoop.stop();
    });
  });
});
