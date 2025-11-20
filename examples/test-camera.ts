/**
 * Simple test to check webcam status
 */

import { detectWebcamBackend, createWebcamCapture } from '../src/vision/webcamCapture';

async function testCamera() {
  console.log('Testing webcam detection...\n');

  // Detect available backend
  const backend = await detectWebcamBackend();
  console.log(`Detected backend: ${backend}`);

  if (backend === 'mock') {
    console.log('\n⚠️  No real webcam libraries installed.');
    console.log('Using MOCK mode (simulated camera data).\n');
    console.log('To use real camera, install:');
    console.log('  npm install node-webcam');
    console.log('  OR');
    console.log('  npm install opencv4nodejs (requires OpenCV system library)\n');
  }

  // Try to create and start capture
  try {
    const capture = createWebcamCapture({
      backend,
      width: 640,
      height: 480,
      fps: 2,
    });

    console.log('\nStarting capture...');
    await capture.start();

    console.log('✓ Capture started successfully!');
    console.log(`Active: ${capture.isActive()}\n`);

    // Capture a few test frames
    console.log('Capturing 3 test frames...');
    for (let i = 0; i < 3; i++) {
      const frame = await capture.captureFrame();
      if (frame) {
        console.log(`Frame ${i + 1}: ${frame.width}x${frame.height}, ${frame.format}, source: ${frame.source}`);
      } else {
        console.log(`Frame ${i + 1}: null (capture failed)`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    capture.stop();
    console.log('\n✓ Camera test complete!');

  } catch (error) {
    console.error('\n✗ Camera error:', error);
  }
}

testCamera().catch(console.error);
