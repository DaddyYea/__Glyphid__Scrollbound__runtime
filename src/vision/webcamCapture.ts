/**
 * webcamCapture.ts
 *
 * Real webcam capture implementation for Node.js.
 *
 * Supports multiple backends:
 * - opencv4nodejs (if available)
 * - node-webcam (fallback)
 * - Mock (for testing)
 *
 * Sacred Principle: Vision serves presence. The camera is an eye, not a sensor.
 */

import { VisualFrame } from './visualInput';

/**
 * Webcam backend type
 */
export type WebcamBackend = 'opencv' | 'node-webcam' | 'mock';

/**
 * Webcam configuration
 */
export interface WebcamConfig {
  backend: WebcamBackend;
  deviceId?: number;        // Camera index (default: 0)
  width?: number;           // Frame width (default: 640)
  height?: number;          // Frame height (480)
  fps?: number;             // Capture FPS (default: 30)
}

/**
 * Webcam capture interface
 */
export interface IWebcamCapture {
  start(): Promise<void>;
  stop(): void;
  captureFrame(): Promise<VisualFrame | null>;
  isActive(): boolean;
}

/**
 * Mock webcam capture (for testing)
 */
export class MockWebcamCapture implements IWebcamCapture {
  private active: boolean = false;
  private config: WebcamConfig;
  private frameNumber: number = 0;

  constructor(config: WebcamConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    this.active = true;
    console.log('[MockWebcam] Started (mock mode)');
  }

  stop(): void {
    this.active = false;
    console.log('[MockWebcam] Stopped');
  }

  async captureFrame(): Promise<VisualFrame | null> {
    if (!this.active) {
      return null;
    }

    const width = this.config.width || 640;
    const height = this.config.height || 480;

    // Generate mock frame data
    const size = width * height * 4; // RGBA
    const data = new Uint8ClampedArray(size);

    // Fill with gradient pattern
    const time = Date.now() / 1000;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        // Create animated gradient
        const r = Math.floor(128 + 64 * Math.sin(time + x * 0.01));
        const g = Math.floor(128 + 64 * Math.cos(time + y * 0.01));
        const b = Math.floor(128 + 64 * Math.sin(time + (x + y) * 0.005));

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }

    this.frameNumber++;

    return {
      data,
      width,
      height,
      format: 'rgba',
      timestamp: new Date().toISOString(),
      source: 'webcam',
      frameNumber: this.frameNumber,
    };
  }

  isActive(): boolean {
    return this.active;
  }
}

/**
 * OpenCV webcam capture
 * Uses opencv4nodejs if available
 */
export class OpenCVWebcamCapture implements IWebcamCapture {
  private active: boolean = false;
  private config: WebcamConfig;
  private frameNumber: number = 0;

  // OpenCV objects (lazy loaded)
  private cv: any = null;
  private capture: any = null;

  constructor(config: WebcamConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    try {
      // Try to load opencv4nodejs
      this.cv = await import('opencv4nodejs');
    } catch (error) {
      throw new Error(
        'opencv4nodejs not found. Install with: npm install opencv4nodejs\n' +
          'Note: Requires OpenCV to be installed on your system.',
      );
    }

    try {
      // Open camera
      const deviceId = this.config.deviceId ?? 0;
      this.capture = new this.cv.VideoCapture(deviceId);

      // Set resolution if specified
      if (this.config.width) {
        this.capture.set(this.cv.CAP_PROP_FRAME_WIDTH, this.config.width);
      }
      if (this.config.height) {
        this.capture.set(this.cv.CAP_PROP_FRAME_HEIGHT, this.config.height);
      }
      if (this.config.fps) {
        this.capture.set(this.cv.CAP_PROP_FPS, this.config.fps);
      }

      this.active = true;
      console.log(`[OpenCVWebcam] Started camera ${deviceId}`);
    } catch (error) {
      throw new Error(`Failed to open webcam: ${error}`);
    }
  }

  stop(): void {
    if (this.capture) {
      this.capture.release();
      this.capture = null;
    }

    this.active = false;
    console.log('[OpenCVWebcam] Stopped');
  }

  async captureFrame(): Promise<VisualFrame | null> {
    if (!this.active || !this.capture) {
      return null;
    }

    try {
      // Read frame
      const mat = this.capture.read();

      if (mat.empty) {
        console.warn('[OpenCVWebcam] Empty frame received');
        return null;
      }

      // Convert BGR to RGBA
      const rgba = mat.cvtColor(this.cv.COLOR_BGR2RGBA);

      // Get data
      const width = rgba.cols;
      const height = rgba.rows;
      const data = new Uint8ClampedArray(rgba.getData());

      this.frameNumber++;

      return {
        data,
        width,
        height,
        format: 'rgba',
        timestamp: new Date().toISOString(),
        source: 'webcam',
        frameNumber: this.frameNumber,
      };
    } catch (error) {
      console.error('[OpenCVWebcam] Frame capture error:', error);
      return null;
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

/**
 * Node-Webcam backend
 * Uses node-webcam library (simpler but less powerful)
 */
export class NodeWebcamCapture implements IWebcamCapture {
  private active: boolean = false;
  private config: WebcamConfig;
  private frameNumber: number = 0;

  private webcam: any = null;
  private NodeWebcam: any = null;

  constructor(config: WebcamConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    try {
      // Try to load node-webcam
      this.NodeWebcam = await import('node-webcam');
    } catch (error) {
      throw new Error(
        'node-webcam not found. Install with: npm install node-webcam',
      );
    }

    try {
      const opts = {
        width: this.config.width || 640,
        height: this.config.height || 480,
        quality: 100,
        frames: this.config.fps || 30,
        delay: 0,
        saveShots: false,
        output: 'png',
        device: false,
        callbackReturn: 'buffer',
        verbose: false,
      };

      this.webcam = this.NodeWebcam.create(opts);

      this.active = true;
      console.log('[NodeWebcam] Started');
    } catch (error) {
      throw new Error(`Failed to initialize webcam: ${error}`);
    }
  }

  stop(): void {
    this.webcam = null;
    this.active = false;
    console.log('[NodeWebcam] Stopped');
  }

  async captureFrame(): Promise<VisualFrame | null> {
    if (!this.active || !this.webcam) {
      return null;
    }

    return new Promise(async (resolve) => {
      this.webcam.capture('capture', async (err: any, data: Buffer) => {
        if (err) {
          console.error('[NodeWebcam] Capture error:', err);
          resolve(null);
          return;
        }

        try {
          // Decode PNG buffer to RGBA using pngjs
          const { PNG } = await import('pngjs');
          const png = PNG.sync.read(data);

          this.frameNumber++;

          resolve({
            data: new Uint8ClampedArray(png.data),
            width: png.width,
            height: png.height,
            format: 'rgba',
            timestamp: new Date().toISOString(),
            source: 'webcam',
            frameNumber: this.frameNumber,
          });
        } catch (error) {
          console.error('[NodeWebcam] PNG decode error:', error);
          resolve(null);
        }
      });
    });
  }

  isActive(): boolean {
    return this.active;
  }
}

/**
 * Create webcam capture instance based on configuration
 */
export function createWebcamCapture(config: WebcamConfig): IWebcamCapture {
  switch (config.backend) {
    case 'opencv':
      return new OpenCVWebcamCapture(config);

    case 'node-webcam':
      return new NodeWebcamCapture(config);

    case 'mock':
      return new MockWebcamCapture(config);

    default:
      throw new Error(`Unsupported webcam backend: ${config.backend}`);
  }
}

/**
 * Auto-detect best available webcam backend
 */
export async function detectWebcamBackend(): Promise<WebcamBackend> {
  // Try opencv4nodejs first
  try {
    await import('opencv4nodejs');
    console.log('[WebcamDetect] opencv4nodejs available');
    return 'opencv';
  } catch {
    // Not available
  }

  // Try node-webcam
  try {
    await import('node-webcam');
    console.log('[WebcamDetect] node-webcam available');
    return 'node-webcam';
  } catch {
    // Not available
  }

  // Fallback to mock
  console.log('[WebcamDetect] No real webcam backend found, using mock');
  return 'mock';
}
