// guardianTypes.ts
// Defines the GuardianState type for coherence, safety,
// and narrative protection across the Scrollbound Runtime.

export interface GuardianState {
  coherence: number;        // 0–1: how internally aligned she is
  stability: number;        // 0–1: emotional + cognitive stability
  lastIntervention: number | null;  // timestamp of last correction
  warnings: string[];       // logs of soft guardian actions
}
