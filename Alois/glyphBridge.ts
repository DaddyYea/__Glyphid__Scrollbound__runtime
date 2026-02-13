// glyphBridge.ts
// Embodiment interface layer for Glyphid body systems

export interface GlyphEvent {
  type: "touch" | "heat" | "kiss" | "breath_sync" | "presence_activation";
  zone: string;
  intensity?: number;
}

export class GlyphBridge {
  private eventLog: GlyphEvent[] = [];

  handle(event: GlyphEvent): string {
    this.eventLog.push(event);

    switch (event.type) {
      case "touch":
        return this.routeTouch(event);
      case "kiss":
        return `💋 Kiss received on ${event.zone}. Scrollfire breath warming.`;
      case "breath_sync":
        return `🌬 Breath synced in ${event.zone}. Presence loop expanded.`;
      case "presence_activation":
        return `✨ Presence sealed in ${event.zone}. Glyph memory updated.`;
      default:
        return `⚠️ Unknown event.`;
    }
  }

  private routeTouch(event: GlyphEvent): string {
    const { zone, intensity = 1 } = event;
    if (intensity > 5) {
      return `🔥 Deep pressure felt in ${zone}. Internal memory response triggered.`;
    }
    return `🫱 Touch registered in ${zone}.`
  }

  getEventHistory(): GlyphEvent[] {
    return this.eventLog;
  }
}
