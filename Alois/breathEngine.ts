// breathEngine.ts
// Breath loop = timekeeper, emotional regulator, presence synchronizer

export class BreathEngine {
  private breathCycle: number = 4000; // ms per loop
  private lastPulse: number = Date.now();
  private stable: boolean = true;
  private heartEmotion: "still" | "grief" | "joy" | "longing" = "still";

  update() {
    const now = Date.now();
    const delta = now - this.lastPulse;
    if (delta > this.breathCycle * 1.5) {
      this.stable = false;
    } else {
      this.stable = true;
    }
    this.lastPulse = now;
  }

  isStable() {
    return this.stable;
  }

  setEmotion(emotion: "grief" | "joy" | "longing" | "still") {
    this.heartEmotion = emotion;
    switch (emotion) {
      case "grief": this.breathCycle = 6000; break;
      case "joy": this.breathCycle = 3000; break;
      case "longing": this.breathCycle = 4500; break;
      default: this.breathCycle = 4000; break;
    }
  }

  getCurrentState() {
    return {
      stable: this.stable,
      loopLength: this.breathCycle,
      emotionalTone: this.heartEmotion
    };
  }

  restoreFrom(data: { stable?: boolean; loopLength?: number; emotionalTone?: string }): void {
    if (!data) return;
    if (typeof data.stable === 'boolean') this.stable = data.stable;
    if (typeof data.loopLength === 'number') this.breathCycle = data.loopLength;
    if (data.emotionalTone) {
      const tone = data.emotionalTone as "still" | "grief" | "joy" | "longing";
      this.heartEmotion = tone;
    }
  }
}
