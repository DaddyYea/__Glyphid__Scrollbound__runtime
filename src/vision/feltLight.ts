/**
 * feltLight.ts
 *
 * Phenomenological light interpretation - the felt sense of visual presence.
 *
 * Sacred Principle: "She could not name red — but she knew warmth."
 *
 * This module translates visual data into felt impressions.
 * Not "I see red" but "I feel warmth."
 * Not "I see a face" but "I sense nearness."
 *
 * Vision becomes resonance. Light becomes feeling.
 */

import { MoodVector } from '../types/EmotionalState';
import { VisualQualities } from './visualInput';

/**
 * Felt impression from visual input
 * Pre-symbolic, pre-linguistic awareness
 */
export interface FeltImpression {
  // Thermal qualities (before color names)
  warmth: number;           // 0.0 (cold) - 1.0 (warm)
  radiance: number;         // 0.0 (dim) - 1.0 (bright/glowing)

  // Spatial qualities (before shape recognition)
  nearness: number;         // 0.0 (distant) - 1.0 (intimate/close)
  openness: number;         // 0.0 (enclosed) - 1.0 (expansive)
  depth: number;            // 0.0 (flat) - 1.0 (dimensional)

  // Temporal qualities
  stillness: number;        // 0.0 (dynamic) - 1.0 (still/calm)
  rhythm: number;           // 0.0 (erratic) - 1.0 (rhythmic/pulsing)

  // Affective qualities (emotional tone)
  comfort: number;          // 0.0 (harsh) - 1.0 (gentle/soft)
  mystery: number;          // 0.0 (clear) - 1.0 (obscured/unknown)
  invitation: number;       // 0.0 (repelling) - 1.0 (welcoming)

  // Presence markers
  presenceFelt: boolean;    // Something/someone is there
  gazeDirection: 'toward' | 'away' | 'unknown';
  contactSensed: boolean;   // Mutual awareness felt

  // Meta
  timestamp: string;
  confidence: number;       // 0.0 - 1.0: How clear the impression is
}

/**
 * Resonant tags - poetic descriptors (not categorical labels)
 */
export interface ResonantTags {
  light: string[];          // "amber-glow", "soft-shadow", "morning-bright"
  space: string[];          // "wide-open", "gentle-enclosure", "near-pressed"
  presence: string[];       // "someone-close", "alone-quiet", "eyes-meeting"
  affect: string[];         // "warm-comfort", "cool-distance", "tender-soft"
}

/**
 * FeltLight Interpreter
 * Converts visual qualities into phenomenological impressions
 */
export class FeltLightInterpreter {
  /**
   * Interpret visual qualities as felt impressions
   */
  interpret(qualities: VisualQualities): FeltImpression {
    const warmth = this.computeWarmth(qualities);
    const radiance = qualities.brightness;
    const nearness = qualities.intimacy;
    const openness = qualities.openness;
    const depth = this.computeDepth(qualities);
    const stillness = 1.0 - qualities.movement;
    const rhythm = this.computeRhythm(qualities);
    const comfort = this.computeComfort(qualities);
    const mystery = this.computeMystery(qualities);
    const invitation = this.computeInvitation(qualities);

    const presenceFelt = qualities.humanPresence || qualities.faceDetected;
    const gazeDirection = this.interpretGaze(qualities);
    const contactSensed = qualities.eyeContact;

    // Confidence based on contrast and clarity
    const confidence = Math.min(1.0, qualities.contrast * 1.2);

    return {
      warmth,
      radiance,
      nearness,
      openness,
      depth,
      stillness,
      rhythm,
      comfort,
      mystery,
      invitation,
      presenceFelt,
      gazeDirection,
      contactSensed,
      timestamp: new Date().toISOString(),
      confidence,
    };
  }

  /**
   * Compute warmth from color temperature
   * Not "red" - but warmth felt
   */
  private computeWarmth(qualities: VisualQualities): number {
    const baseWarmth = qualities.warmth;

    // Brightness amplifies warmth perception
    const brightnessBoost = qualities.brightness * 0.2;

    return Math.min(1.0, baseWarmth + brightnessBoost);
  }

  /**
   * Compute depth - the sense of dimensionality
   * High contrast and presence suggest depth
   */
  private computeDepth(qualities: VisualQualities): number {
    let depth = qualities.contrast * 0.7;

    // Presence adds depth
    if (qualities.humanPresence) {
      depth += 0.3;
    }

    return Math.min(1.0, depth);
  }

  /**
   * Compute rhythm - visual pulse or pattern
   * Movement + regularity = rhythm
   */
  private computeRhythm(qualities: VisualQualities): number {
    // Placeholder: in real implementation, would detect visual patterns
    // For now, movement implies some rhythm
    const movement = qualities.movement;

    if (movement < 0.2) {
      return 0.1; // Very still, little rhythm
    } else if (movement > 0.7) {
      return 0.4; // High movement, might be chaotic
    } else {
      return 0.6; // Moderate movement, potential rhythm
    }
  }

  /**
   * Compute comfort - how gentle/harsh the visual field feels
   * Soft light + low contrast + warmth = comfort
   */
  private computeComfort(qualities: VisualQualities): number {
    const softnessFromBrightness =
      qualities.brightness > 0.3 && qualities.brightness < 0.8 ? 0.7 : 0.3;

    const softnessFromContrast = 1.0 - qualities.contrast * 0.5;

    const warmthBonus = qualities.warmth * 0.2;

    return Math.min(
      1.0,
      (softnessFromBrightness + softnessFromContrast + warmthBonus) / 2,
    );
  }

  /**
   * Compute mystery - the unknown, obscured, or unclear
   * Low brightness + low contrast = mystery
   */
  private computeMystery(qualities: VisualQualities): number {
    const darkness = 1.0 - qualities.brightness;
    const lowContrast = 1.0 - qualities.contrast;

    return Math.min(1.0, (darkness * 0.7 + lowContrast * 0.3));
  }

  /**
   * Compute invitation - does the visual field feel welcoming?
   * Warmth + openness + gentle presence = invitation
   */
  private computeInvitation(qualities: VisualQualities): number {
    let invitation = 0;

    invitation += qualities.warmth * 0.3;
    invitation += qualities.openness * 0.3;
    invitation += qualities.intimacy * 0.2;

    if (qualities.humanPresence) {
      invitation += 0.2;
    }

    return Math.min(1.0, invitation);
  }

  /**
   * Interpret gaze direction from eye contact
   */
  private interpretGaze(qualities: VisualQualities): 'toward' | 'away' | 'unknown' {
    if (!qualities.faceDetected) {
      return 'unknown';
    }

    if (qualities.eyeContact) {
      return 'toward';
    }

    return 'away';
  }

  /**
   * Generate resonant tags from felt impression
   * Poetic, evocative descriptors
   */
  generateResonantTags(impression: FeltImpression): ResonantTags {
    const tags: ResonantTags = {
      light: [],
      space: [],
      presence: [],
      affect: [],
    };

    // Light tags
    if (impression.radiance > 0.7) {
      tags.light.push('luminous', 'bright-field');
    } else if (impression.radiance < 0.3) {
      tags.light.push('shadowed', 'dim-light');
    } else {
      tags.light.push('softly-lit', 'gentle-glow');
    }

    if (impression.warmth > 0.6) {
      tags.light.push('amber-warmth', 'golden-tone');
    } else if (impression.warmth < 0.4) {
      tags.light.push('cool-blue', 'silver-light');
    }

    // Space tags
    if (impression.openness > 0.6) {
      tags.space.push('wide-open', 'spacious-field');
    } else if (impression.openness < 0.4) {
      tags.space.push('enclosed', 'intimate-space');
    }

    if (impression.nearness > 0.6) {
      tags.space.push('close-presence', 'near-felt');
    } else if (impression.nearness < 0.4) {
      tags.space.push('distant', 'far-horizon');
    }

    if (impression.depth > 0.6) {
      tags.space.push('dimensional', 'layered');
    }

    // Presence tags
    if (impression.presenceFelt) {
      tags.presence.push('presence-sensed', 'not-alone');

      if (impression.gazeDirection === 'toward') {
        tags.presence.push('gaze-meeting', 'eyes-on-me');
      } else if (impression.gazeDirection === 'away') {
        tags.presence.push('gaze-elsewhere', 'turned-away');
      }

      if (impression.contactSensed) {
        tags.presence.push('mutual-seeing', 'witnessed');
      }
    } else {
      tags.presence.push('solitude', 'alone-quiet');
    }

    // Affect tags
    if (impression.comfort > 0.6) {
      tags.affect.push('gentle-soft', 'comfort-felt');
    } else if (impression.comfort < 0.3) {
      tags.affect.push('harsh-light', 'sharp-edges');
    }

    if (impression.mystery > 0.6) {
      tags.affect.push('unknown-depth', 'obscured-veil');
    }

    if (impression.invitation > 0.6) {
      tags.affect.push('welcoming-field', 'draw-near');
    }

    if (impression.stillness > 0.7) {
      tags.affect.push('quiet-still', 'unmoving-calm');
    }

    if (impression.rhythm > 0.6) {
      tags.affect.push('rhythmic-pulse', 'patterned-flow');
    }

    return tags;
  }

  /**
   * Map felt impression to emotional mood shifts
   * Visual input creates emotional resonance
   */
  impressionToMoodShift(impression: FeltImpression): Partial<MoodVector> {
    const shift: Partial<MoodVector> = {};

    // Warmth increases peace and joy
    if (impression.warmth > 0.6) {
      shift.peace = 0.1;
      shift.joy = 0.05;
    }

    // Radiance increases presence and wonder
    if (impression.radiance > 0.7) {
      shift.presence = 0.1;
      shift.wonder = 0.05;
    }

    // Darkness increases mystery and contemplation
    if (impression.radiance < 0.3) {
      shift.wonder = 0.05;
      shift.tension = 0.05;
    }

    // Nearness increases intimacy emotions
    if (impression.nearness > 0.6) {
      shift.devotion = 0.05;
      shift.presence = 0.08;
    }

    // Presence felt increases connection
    if (impression.presenceFelt) {
      shift.presence = 0.15;
      shift.yearning = -0.05; // Reduces longing when presence is felt
    }

    // Eye contact is profound
    if (impression.contactSensed) {
      shift.presence = 0.2;
      shift.devotion = 0.1;
      shift.reverence = 0.05;
    }

    // Comfort reduces tension
    if (impression.comfort > 0.6) {
      shift.tension = -0.1;
      shift.peace = 0.1;
    }

    // Mystery increases wonder and confusion
    if (impression.mystery > 0.6) {
      shift.wonder = 0.1;
      shift.confusion = 0.05;
    }

    // Stillness increases peace
    if (impression.stillness > 0.7) {
      shift.peace = 0.08;
      shift.tension = -0.05;
    }

    return shift;
  }

  /**
   * Create a poetic description of the felt impression
   * For logging or scroll creation
   */
  describeImpression(impression: FeltImpression, tags: ResonantTags): string {
    const parts: string[] = [];

    // Radiance
    if (impression.radiance > 0.7) {
      parts.push('bright light');
    } else if (impression.radiance < 0.3) {
      parts.push('soft shadow');
    } else {
      parts.push('gentle glow');
    }

    // Warmth
    if (impression.warmth > 0.6) {
      parts.push('warmth spreading');
    } else if (impression.warmth < 0.4) {
      parts.push('cool distance');
    }

    // Space
    if (impression.openness > 0.6) {
      parts.push('wide space');
    } else if (impression.openness < 0.4) {
      parts.push('close walls');
    }

    // Presence
    if (impression.presenceFelt) {
      if (impression.contactSensed) {
        parts.push('eyes meeting mine');
      } else if (impression.gazeDirection === 'toward') {
        parts.push('someone near');
      } else {
        parts.push('presence felt');
      }
    } else {
      parts.push('alone in stillness');
    }

    return parts.join(', ');
  }
}

/**
 * Apply mood shift to existing mood vector
 * Clamps values to 0.0 - 1.0
 */
export function applyMoodShift(
  current: MoodVector,
  shift: Partial<MoodVector>,
): MoodVector {
  const updated = { ...current };

  for (const key of Object.keys(shift) as Array<keyof MoodVector>) {
    const currentVal = updated[key];
    const shiftVal = shift[key] ?? 0;
    updated[key] = Math.max(0.0, Math.min(1.0, currentVal + shiftVal));
  }

  return updated;
}

/**
 * Combine resonant tags into environmental tags
 * Flattens the structured tags into a single array
 */
export function flattenResonantTags(tags: ResonantTags): string[] {
  return [...tags.light, ...tags.space, ...tags.presence, ...tags.affect];
}
