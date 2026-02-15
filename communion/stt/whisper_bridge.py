"""
Real-Time Speech-to-Text Bridge for Scrollbound Runtime

Uses Whisper Large model to transcribe microphone audio in real-time
and streams the output to the communion server as human messages.

Usage:
  pip install -r requirements.txt
  python whisper_bridge.py

Requires a CUDA GPU for reasonable performance with whisper large.
Use "base" or "small" model for CPU-only machines.
"""

import whisper
import sounddevice as sd
import numpy as np
import threading
import queue
import time
import requests

# Load model — "large" for best accuracy, "base" or "small" for faster/CPU
model = whisper.load_model("large")

# Runtime config
SAMPLE_RATE = 16000
CHUNK_DURATION = 5  # seconds of audio to buffer before transcribing
RUNTIME_ENDPOINT = "http://localhost:3000/transcript"
SPEAKING_ENDPOINT = "http://localhost:3000/speaking"

# Audio buffer — collects chunks until we have CHUNK_DURATION seconds
audio_buffer = []
buffer_lock = threading.Lock()
SAMPLES_PER_CHUNK = SAMPLE_RATE * CHUNK_DURATION

# Cooldown after TTS finishes — mic still picks up reverb/tail for a bit
TTS_COOLDOWN_SECONDS = 0.5
last_tts_end_time = 0.0


def is_agent_speaking():
    """Check if any agent is currently speaking via TTS."""
    global last_tts_end_time
    try:
        resp = requests.get(SPEAKING_ENDPOINT, timeout=1)
        if resp.status_code == 200:
            speaking = resp.json().get("speaking", False)
            if speaking:
                last_tts_end_time = time.time()
            return speaking
    except Exception:
        pass
    return False


def in_cooldown():
    """True if TTS just finished and we're still in the cooldown window."""
    return (time.time() - last_tts_end_time) < TTS_COOLDOWN_SECONDS


def audio_callback(indata, frames, time_info, status):
    if status:
        print(f"[STT] Audio status: {status}")
    with buffer_lock:
        audio_buffer.append(indata.copy())


def audio_stream():
    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype='float32',
        callback=audio_callback,
        blocksize=int(SAMPLE_RATE * 0.5),  # 500ms blocks
    ):
        while True:
            time.sleep(0.1)


def transcribe_loop():
    while True:
        time.sleep(0.5)

        # If an agent is speaking or we're in cooldown, flush the buffer and skip.
        # This prevents TTS output from being transcribed and fed back in.
        if is_agent_speaking() or in_cooldown():
            with buffer_lock:
                audio_buffer.clear()
            continue

        with buffer_lock:
            if not audio_buffer:
                continue
            # Check if we have enough audio
            total_samples = sum(chunk.shape[0] for chunk in audio_buffer)
            if total_samples < SAMPLES_PER_CHUNK:
                continue
            # Grab the buffer and reset
            chunks = audio_buffer.copy()
            audio_buffer.clear()

        # Concatenate all chunks into a single array
        audio_np = np.concatenate(chunks).flatten()

        # Skip if audio is mostly silence (RMS below threshold)
        rms = np.sqrt(np.mean(audio_np ** 2))
        if rms < 0.01:
            continue

        # Double-check speaking state AFTER transcription (agent may have started talking)
        if is_agent_speaking() or in_cooldown():
            print("[STT] Discarding — agent started speaking during transcription")
            continue

        # Whisper expects float32 numpy array at 16kHz
        result = model.transcribe(audio_np, language='en', fp16=True)
        text = result.get("text", "").strip()

        if text and len(text) > 1:
            print(f"[STT] Transcribed: {text}")
            send_to_runtime(text)


def send_to_runtime(text):
    try:
        resp = requests.post(RUNTIME_ENDPOINT, json={"text": text}, timeout=5)
        if resp.status_code != 200:
            print(f"[STT] Runtime returned {resp.status_code}: {resp.text}")
    except Exception as e:
        print(f"[STT] Error sending to runtime: {e}")


if __name__ == "__main__":
    print("[STT] Starting Whisper transcription pipeline...")
    print(f"[STT] Model: large | Sample rate: {SAMPLE_RATE}Hz | Chunk: {CHUNK_DURATION}s")
    print(f"[STT] Sending to: {RUNTIME_ENDPOINT}")
    print(f"[STT] Speaking check: {SPEAKING_ENDPOINT}")
    print("[STT] Speak into your microphone...")
    threading.Thread(target=audio_stream, daemon=True).start()
    transcribe_loop()
