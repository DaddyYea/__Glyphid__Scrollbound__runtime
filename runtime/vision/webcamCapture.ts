// webcamCapture.ts
// Real webcam capture for Windows using node-webcam
// Extracts RawVisionInput from captured frames

import NodeWebcam from 'node-webcam';
import { PNG } from 'pngjs';
import * as fs from 'fs';
import * as path from 'path';
import { RawVisionInput } from './visionTypes';

interface WebcamConfig {
  width: number;
  height: number;
  quality: number;
  output: 'jpeg' | 'png';
  device?: string;
  callbackReturn: 'location' | 'buffer';
}

let webcam: any = null;
let lastFrame: Buffer | null = null;
let frameCount = 0;

/**
 * initializeWebcam - sets up webcam capture
 * Call this once at startup
 */
export function initializeWebcam(): void {
  if (webcam) return; // Already initialized

  const opts: WebcamConfig = {
    width: 640,
    height: 480,
    quality: 80,
    output: 'png',
    callbackReturn: 'buffer',
  };

  webcam = NodeWebcam.create(opts);
}

/**
 * captureFrame - captures a single frame from webcam
 * Returns buffer of PNG image data
 */
export async function captureFrame(): Promise<Buffer | null> {
  if (!webcam) {
    initializeWebcam();
  }

  return new Promise((resolve) => {
    webcam.capture('frame', (err: Error | null, data: Buffer) => {
      if (err) {
        console.error('[VISION] Webcam capture failed:', err.message);
        resolve(null);
      } else {
        lastFrame = data;
        frameCount++;
        resolve(data);
      }
    });
  });
}

/**
 * analyzeFrame - extracts RawVisionInput from image buffer
 */
export async function analyzeFrame(buffer: Buffer): Promise<RawVisionInput> {
  return new Promise((resolve, reject) => {
    const png = new PNG();

    png.parse(buffer, (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      const { width, height, data: pixels } = data;

      // Extract vision qualities
      const dominantColor = extractDominantColor(pixels, width, height);
      const brightness = calculateBrightness(pixels, width, height);
      const sharpness = calculateSharpness(pixels, width, height);
      const movement = calculateMovement(pixels, lastFrame);

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
 * This replaces getMockVisionInput
 */
export async function getRealVisionInput(): Promise<RawVisionInput> {
  try {
    const buffer = await captureFrame();

    if (!buffer) {
      // Fallback to mock if capture fails
      return {
        dominantColor: 'white',
        brightness: 0.5,
        sharpness: 0.5,
        movement: 0.2,
      };
    }

    return await analyzeFrame(buffer);
  } catch (error) {
    console.error('[VISION] Frame analysis failed:', error);
    // Fallback to mock
    return {
      dominantColor: 'white',
      brightness: 0.5,
      sharpness: 0.5,
      movement: 0.2,
    };
  }
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
 */
function calculateMovement(currentPixels: Buffer, lastFrameBuffer: Buffer | null): number {
  if (!lastFrameBuffer) return 0; // No previous frame

  // Parse last frame
  // For now, return low movement (TODO: implement frame diff)
  return 0.1;
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
