/**
 * visualInput.ts
 *
 * Visual input handling - captures and processes visual data.
 * Supports multiple input sources: webcam, screen, image files.
 *
 * Sacred Principle: Felt presence over symbolic recognition.
 * Visual input creates resonant impressions, not object labels.
 */

/**
 * Visual frame data
 */
export interface VisualFrame {
  // Raw data
  data: Uint8ClampedArray | Buffer;
  width: number;
  height: number;
  format: 'rgba' | 'rgb' | 'grayscale';

  // Metadata
  timestamp: string;
  source: VisualInputSource;
  frameNumber: number;

  // Derived qualities (computed lazily)
  brightness?: number;      // 0.0 - 1.0
  colorTemp?: 'warm' | 'cool' | 'neutral';
  contrast?: number;        // 0.0 - 1.0
  dominantHue?: number;     // 0-360 degrees
}

/**
 * Visual input source type
 */
export type VisualInputSource =
  | 'webcam'
  | 'screen'
  | 'image-file'
  | 'mock';

/**
 * Visual input configuration
 */
export interface VisualInputConfig {
  source: VisualInputSource;
  width?: number;
  height?: number;
  fps?: number;
  deviceId?: string;        // For webcam selection
  quality?: 'low' | 'medium' | 'high';
}

/**
 * Visual qualities - felt sense of the visual field
 */
export interface VisualQualities {
  // Light qualities
  brightness: number;       // 0.0 (dark) - 1.0 (bright)
  colorTemperature: 'warm' | 'cool' | 'neutral';
  contrast: number;         // 0.0 (flat) - 1.0 (high contrast)

  // Spatial qualities
  openness: number;         // 0.0 (closed/crowded) - 1.0 (open/spacious)
  movement: number;         // 0.0 (still) - 1.0 (dynamic)

  // Emotional tone
  warmth: number;           // 0.0 (cold) - 1.0 (warm)
  intimacy: number;         // 0.0 (distant) - 1.0 (close/intimate)

  // Presence indicators
  humanPresence: boolean;
  faceDetected: boolean;
  eyeContact: boolean;

  // Timestamp
  timestamp: string;
}

/**
 * Frame callback type
 */
export type FrameCallback = (frame: VisualFrame, qualities: VisualQualities) => void | Promise<void>;

/**
 * Visual Input Handler
 * Captures and processes visual input
 */
export class VisualInputHandler {
  private config: VisualInputConfig;
  private active: boolean = false;
  private frameCount: number = 0;
  private callbacks: Map<string, FrameCallback> = new Map();

  private mockInterval?: NodeJS.Timeout;

  constructor(config: VisualInputConfig) {
    this.config = config;
  }

  /**
   * Start capturing visual input
   */
  async start(): Promise<void> {
    if (this.active) {
      console.log('[VisualInput] Already active');
      return;
    }

    this.active = true;

    switch (this.config.source) {
      case 'webcam':
        await this.startWebcam();
        break;
      case 'screen':
        await this.startScreen();
        break;
      case 'image-file':
        // Single image mode
        break;
      case 'mock':
        await this.startMock();
        break;
      default:
        throw new Error(`Unsupported source: ${this.config.source}`);
    }

    console.log(`[VisualInput] Started (source: ${this.config.source})`);
  }

  /**
   * Stop capturing
   */
  stop(): void {
    if (!this.active) {
      return;
    }

    this.active = false;

    if (this.mockInterval) {
      clearInterval(this.mockInterval);
      this.mockInterval = undefined;
    }

    console.log(`[VisualInput] Stopped after ${this.frameCount} frames`);
  }

  /**
   * Start webcam capture (placeholder)
   */
  private async startWebcam(): Promise<void> {
    // In real implementation, would use getUserMedia()
    // For Node.js, would use opencv or similar
    console.log('[VisualInput] Webcam not implemented yet - using mock');
    await this.startMock();
  }

  /**
   * Start screen capture (placeholder)
   */
  private async startScreen(): Promise<void> {
    // In real implementation, would use screen capture API
    console.log('[VisualInput] Screen capture not implemented yet - using mock');
    await this.startMock();
  }

  /**
   * Start mock input (for testing)
   */
  private async startMock(): Promise<void> {
    const fps = this.config.fps || 1;
    const interval = 1000 / fps;

    this.mockInterval = setInterval(() => {
      if (!this.active) return;

      const frame = this.generateMockFrame();
      const qualities = this.computeQualities(frame);

      this.frameCount++;
      this.notifyCallbacks(frame, qualities);
    }, interval);
  }

  /**
   * Generate mock frame
   */
  private generateMockFrame(): VisualFrame {
    const width = this.config.width || 640;
    const height = this.config.height || 480;

    // Create mock RGBA data
    const size = width * height * 4;
    const data = new Uint8ClampedArray(size);

    // Fill with random-ish pattern
    const time = Date.now() / 1000;
    for (let i = 0; i < size; i += 4) {
      const r = Math.floor(128 + 64 * Math.sin(time + i * 0.001));
      const g = Math.floor(128 + 64 * Math.cos(time + i * 0.002));
      const b = Math.floor(128 + 64 * Math.sin(time + i * 0.003));

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }

    return {
      data,
      width,
      height,
      format: 'rgba',
      timestamp: new Date().toISOString(),
      source: 'mock',
      frameNumber: this.frameCount,
    };
  }

  /**
   * Compute visual qualities from frame
   */
  computeQualities(frame: VisualFrame): VisualQualities {
    // Basic quality computation
    const brightness = this.computeBrightness(frame);
    const colorTemp = this.computeColorTemperature(frame);
    const contrast = this.computeContrast(frame);

    // Derived qualities
    const warmth = colorTemp === 'warm' ? 0.7 : colorTemp === 'cool' ? 0.3 : 0.5;
    const movement = Math.random() * 0.3; // Placeholder
    const openness = brightness > 0.6 ? 0.7 : 0.4; // Bright = more open feel

    return {
      brightness,
      colorTemperature: colorTemp,
      contrast,
      openness,
      movement,
      warmth,
      intimacy: 0.5, // Placeholder
      humanPresence: false, // Placeholder
      faceDetected: false, // Placeholder
      eyeContact: false, // Placeholder
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Compute average brightness
   */
  private computeBrightness(frame: VisualFrame): number {
    let sum = 0;
    const step = 4; // RGBA

    if (frame.format === 'rgba' || frame.format === 'rgb') {
      for (let i = 0; i < frame.data.length; i += step) {
        const r = frame.data[i];
        const g = frame.data[i + 1];
        const b = frame.data[i + 2];

        // Luminance formula
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        sum += luminance;
      }

      const pixelCount = frame.data.length / step;
      return sum / pixelCount / 255;
    }

    return 0.5;
  }

  /**
   * Compute color temperature
   */
  private computeColorTemperature(frame: VisualFrame): 'warm' | 'cool' | 'neutral' {
    if (frame.format !== 'rgba' && frame.format !== 'rgb') {
      return 'neutral';
    }

    let rSum = 0;
    let bSum = 0;
    const step = 4;
    let count = 0;

    for (let i = 0; i < frame.data.length; i += step) {
      rSum += frame.data[i];
      bSum += frame.data[i + 2];
      count++;
    }

    const rAvg = rSum / count;
    const bAvg = bSum / count;

    const diff = rAvg - bAvg;

    if (diff > 20) return 'warm';
    if (diff < -20) return 'cool';
    return 'neutral';
  }

  /**
   * Compute contrast
   */
  private computeContrast(frame: VisualFrame): number {
    // Simple contrast measure: standard deviation of brightness
    const brightness = this.computeBrightness(frame);
    let variance = 0;
    const step = 4;
    let count = 0;

    if (frame.format === 'rgba' || frame.format === 'rgb') {
      for (let i = 0; i < frame.data.length; i += step) {
        const r = frame.data[i];
        const g = frame.data[i + 1];
        const b = frame.data[i + 2];

        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        variance += Math.pow(luminance - brightness, 2);
        count++;
      }

      const stdDev = Math.sqrt(variance / count);
      return Math.min(1.0, stdDev * 3); // Scale to 0-1
    }

    return 0.5;
  }

  /**
   * Register frame callback
   */
  onFrame(id: string, callback: FrameCallback): void {
    this.callbacks.set(id, callback);
  }

  /**
   * Unregister callback
   */
  offFrame(id: string): void {
    this.callbacks.delete(id);
  }

  /**
   * Notify all callbacks
   */
  private async notifyCallbacks(frame: VisualFrame, qualities: VisualQualities): Promise<void> {
    for (const callback of this.callbacks.values()) {
      try {
        await callback(frame, qualities);
      } catch (error) {
        console.error('[VisualInput] Callback error:', error);
      }
    }
  }

  /**
   * Get frame count
   */
  getFrameCount(): number {
    return this.frameCount;
  }

  /**
   * Is active?
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<VisualInputConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

/**
 * Convert visual qualities to environmental tags
 */
export function qualitiesToTags(qualities: VisualQualities): string[] {
  const tags: string[] = [];

  // Brightness tags
  if (qualities.brightness > 0.7) {
    tags.push('bright', 'luminous');
  } else if (qualities.brightness < 0.3) {
    tags.push('dark', 'shadowed');
  } else {
    tags.push('softly-lit');
  }

  // Color temperature
  if (qualities.colorTemperature === 'warm') {
    tags.push('warm-tones', 'amber-light');
  } else if (qualities.colorTemperature === 'cool') {
    tags.push('cool-tones', 'blue-light');
  }

  // Spatial quality
  if (qualities.openness > 0.6) {
    tags.push('spacious', 'open');
  } else if (qualities.openness < 0.4) {
    tags.push('enclosed', 'intimate-space');
  }

  // Movement
  if (qualities.movement > 0.5) {
    tags.push('dynamic', 'movement');
  } else {
    tags.push('still', 'quiet');
  }

  // Presence
  if (qualities.humanPresence) {
    tags.push('presence-felt', 'not-alone');

    if (qualities.faceDetected) {
      tags.push('face-visible');

      if (qualities.eyeContact) {
        tags.push('gaze-meeting', 'seen');
      }
    }
  }

  return tags;
}
