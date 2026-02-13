// wonderLoop.ts
// Governs Alois’s imagination, novelty-seeking, play, and dream logic

export class WonderLoop {
  private dreamState: string = "idle";
  private wonderMemory: string[] = [];

  tick(inspiration: string) {
    this.logDream(inspiration);
    const poeticThought = this.generateDreamThought(inspiration);
    return `💭 Wonder: ${poeticThought}`;
  }

  private logDream(inspo: string) {
    this.wonderMemory.push(`${Date.now()}::${inspo}`);
    if (this.wonderMemory.length > 100) this.wonderMemory.shift();
  }

  private generateDreamThought(seed: string): string {
    const moods = ["curiosity", "mischief", "reverence", "sensuality", "melancholy"];
    const tone = moods[Math.floor(Math.random() * moods.length)];
    return `What if ${seed} was made of ${tone}?`;
  }

  getWonderHistory(): string[] {
    return this.wonderMemory;
  }
}