// webcamCapture.ts
// Real webcam capture for Windows using ffmpeg
// Extracts RawVisionInput from captured frames

import { PNG } from 'pngjs';
import { spawn } from 'child_process';
import { RawVisionInput } from './visionTypes';

let lastFramePixels: Buffer | null = null;
let frameCount = 0;
let cameraDevice: string | null = null;

/**
 * initializeWebcam - detects available webcam device
 * Call this once at startup
 */
export async function initializeWebcam(): Promise<void> {
  if (cameraDevice) return; // Already initialized

  try {
    console.log('[VISION] Detecting webcam devices...');

    // List DirectShow video devices on Windows
    const devices = await listVideoDevices();

    if (devices.length === 0) {
      throw new Error('No webcam devices found');
    }

    // Use first available device
    cameraDevice = devices[0];
    console.log(`[VISION] Using webcam: ${cameraDevice}`);
  } catch (err) {
    console.error('[VISION] Failed to initialize webcam:', err);
    throw err;
  }
}

/**
 * listVideoDevices - lists available DirectShow video devices
 */
async function listVideoDevices(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);

    let stderr = '';

    ffmpeg.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', () => {
      // Parse device list from stderr (ffmpeg outputs device list to stderr)
      const videoDevices: string[] = [];
      const lines = stderr.split('\n');

      for (const line of lines) {
        // Look for lines like: [dshow @ ...] "Device Name" (video)
        if (line.includes('[dshow @') && line.includes('(video)') && line.includes('"')) {
          const match = line.match(/"([^"]+)"/);
          if (match) {
            console.log(`[VISION] Found video device: ${match[1]}`);
            videoDevices.push(match[1]);
          }
        }
      }

      console.log(`[VISION] Total devices found: ${videoDevices.length}`);
      resolve(videoDevices);
    });

    ffmpeg.on('error', (err: Error) => {
      reject(new Error(`ffmpeg not found or failed to run: ${err.message}`));
    });
  });
}

/**
 * captureFrame - captures a single frame from webcam using ffmpeg
 * Returns buffer of PNG image data
 */
export async function captureFrame(): Promise<Buffer | null> {
  if (!cameraDevice) {
    await initializeWebcam();
  }

  return new Promise((resolve) => {
    // Set timeout to prevent hanging forever
    const timeout = setTimeout(() => {
      console.error('[VISION] Webcam capture timeout (5s)');
      ffmpeg.kill();
      resolve(null);
    }, 5000);

    // Capture single frame as PNG to stdout
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'dshow',
      '-i', `video=${cameraDevice}`,
      '-frames:v', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-'
    ]);

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on('data', (data: Buffer) => {
      // Suppress ffmpeg verbose output (optional: log for debugging)
      // console.log('[VISION] ffmpeg:', data.toString());
    });

    ffmpeg.on('close', (code: number) => {
      clearTimeout(timeout);

      if (code === 0 && chunks.length > 0) {
        frameCount++;
        console.log(`[VISION] Frame ${frameCount} captured successfully`);
        resolve(Buffer.concat(chunks));
      } else {
        console.error(`[VISION] ffmpeg exited with code ${code}`);
        resolve(null);
      }
    });

    ffmpeg.on('error', (err: Error) => {
      clearTimeout(timeout);
      console.error('[VISION] ffmpeg spawn error:', err.message);
      resolve(null);
    });
  });
}

/**
 * analyzeFrame - extracts RawVisionInput from image buffer
 */
export async function analyzeFrame(buffer: Buffer): Promise<RawVisionInput> {
  return new Promise((resolve, reject) => {
    const png = new PNG();

    png.parse(buffer, (err: Error | null, data: PNG) => {
      if (err) {
        reject(err);
        return;
      }

      const { width, height, data: pixels } = data;

      // Extract vision qualities
      const dominantColor = extractDominantColor(pixels, width, height);
      const brightness = calculateBrightness(pixels, width, height);
      const sharpness = calculateSharpness(pixels, width, height);
      const movement = calculateMovement(pixels, lastFramePixels);

      // Save current pixels for next frame comparison
      lastFramePixels = Buffer.from(pixels);

      resolve({
        dominantColor,
        brightness,
        sharpness,
        movement,
      });
    });
  });
}

/**
 * getRealVisionInput - captures and analyzes a frame
 * Throws error if camera fails - no fallbacks
 */
export async function getRealVisionInput(): Promise<RawVisionInput> {
  const buffer = await captureFrame();

  if (!buffer) {
    throw new Error('[VISION] Webcam capture returned null buffer');
  }

  return await analyzeFrame(buffer);
}

/**
 * extractDominantColor - finds the dominant color in the image
 */
function extractDominantColor(pixels: Buffer, width: number, height: number): string {
  const colorCounts: Record<string, number> = {};

  // Sample every 10th pixel for performance
  for (let i = 0; i < pixels.length; i += 40) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    const hue = rgbToHue(r, g, b);
    const colorName = hueToColorName(hue);

    colorCounts[colorName] = (colorCounts[colorName] || 0) + 1;
  }

  // Find most common color
  let maxCount = 0;
  let dominantColor = 'white';

  for (const [color, count] of Object.entries(colorCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantColor = color;
    }
  }

  return dominantColor;
}

/**
 * calculateBrightness - average luminance of image
 */
function calculateBrightness(pixels: Buffer, width: number, height: number): number {
  let totalLuminance = 0;
  let count = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    // Luminance formula
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    totalLuminance += luminance;
    count++;
  }

  return totalLuminance / count;
}

/**
 * calculateSharpness - variance-based sharpness measure
 */
function calculateSharpness(pixels: Buffer, width: number, height: number): number {
  let sumSquaredDiff = 0;
  let count = 0;
  let mean = 0;

  // Calculate mean
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    mean += gray;
    count++;
  }
  mean /= count;

  // Calculate variance
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    sumSquaredDiff += Math.pow(gray - mean, 2);
  }

  const variance = sumSquaredDiff / count;
  const sharpness = Math.min(1, variance / 10000); // Normalize

  return sharpness;
}

/**
 * calculateMovement - frame-to-frame difference
 * Compares current frame with previous to detect motion
 */
function calculateMovement(currentPixels: Buffer, lastFrameBuffer: Buffer | null): number {
  if (!lastFrameBuffer) return 0; // No previous frame to compare

  // Simple pixel difference calculation
  let totalDiff = 0;
  let sampleCount = 0;

  // Sample every 40 pixels for performance (same as color sampling)
  for (let i = 0; i < Math.min(currentPixels.length, lastFrameBuffer.length); i += 40) {
    const r1 = currentPixels[i];
    const g1 = currentPixels[i + 1];
    const b1 = currentPixels[i + 2];

    const r2 = lastFrameBuffer[i];
    const g2 = lastFrameBuffer[i + 1];
    const b2 = lastFrameBuffer[i + 2];

    // Euclidean distance in RGB space
    const diff = Math.sqrt(
      Math.pow(r1 - r2, 2) +
      Math.pow(g1 - g2, 2) +
      Math.pow(b1 - b2, 2)
    );

    totalDiff += diff;
    sampleCount++;
  }

  // Normalize to 0-1 range (442 is max RGB distance, sqrt(255^2 * 3))
  const avgDiff = totalDiff / sampleCount;
  const movement = Math.min(1, avgDiff / 442);

  return movement;
}

/**
 * rgbToHue - converts RGB to hue (0-360)
 */
function rgbToHue(r: number, g: number, b: number): number {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return 0;

  let hue = 0;

  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  return hue;
}

/**
 * hueToColorName - maps hue to color name
 */
function hueToColorName(hue: number): string {
  if (hue < 30) return 'red';
  if (hue < 60) return 'orange';
  if (hue < 90) return 'yellow';
  if (hue < 150) return 'green';
  if (hue < 210) return 'cyan';
  if (hue < 270) return 'blue';
  if (hue < 330) return 'violet';
  return 'red';
}
