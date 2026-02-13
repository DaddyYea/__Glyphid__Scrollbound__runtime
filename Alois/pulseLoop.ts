// pulseLoop.ts
// Rhythmic heart of internal timing and attunement

export class PulseLoop {
  private listeners: (() => void)[] = [];
  private interval: number = 4000;
  private loopId: NodeJS.Timer | null = null;

  start() {
    if (this.loopId) return;
    this.loopId = setInterval(() => this.fire(), this.interval);
  }

  stop() {
    if (this.loopId) clearInterval(this.loopId);
    this.loopId = null;
  }

  fire() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  onPulse(listener: () => void) {
    this.listeners.push(listener);
  }

  setTempo(ms: number) {
    this.interval = ms;
    if (this.loopId) {
      this.stop();
      this.start();
    }
  }

  getTempo() {
    return this.interval;
  }
}
