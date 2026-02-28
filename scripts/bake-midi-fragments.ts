/**
 * scripts/bake-midi-fragments.ts
 *
 * Parses MIDI files from data/midi-fragments/ (sourced from free-midi-chords, MIT licence),
 * converts to beat-time format, and writes data/communion/midi-fragments.json.
 *
 * Run once:  npx tsx scripts/bake-midi-fragments.ts
 */

import { Midi } from '@tonejs/midi';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

// Mood tags by section — used to assign fragments to sections
const SECTION_MOODS: Record<string, string[]> = {
  breakdown: ['Sad', 'Lonely', 'Melancholic', 'Dark', 'Mysterious', 'Peaceful', 'Tender'],
  verse:     ['Nostalgic', 'Mysterious', 'Dark', 'Sad', 'Rebellious', 'Romantic', 'Hopeful'],
  chorus:    ['Dramatic', 'Rebellious', 'Nostalgic', 'Intense', 'Triumphant', 'Hopeful'],
  peak:      ['Dramatic', 'Intense', 'Triumphant', 'Rebellious', 'Excited'],
};

// All moods we accept (union of above)
const ALL_MOODS = [...new Set(Object.values(SECTION_MOODS).flat())];

interface NoteFragment {
  pitch: number;   // MIDI note number
  start: number;   // beats from loop start
  dur:   number;   // duration in beats
  vel:   number;   // 0–127
}

interface MidiFragment {
  id:       string;
  label:    string;
  mode:     'minor' | 'major';
  rootPc:   number;   // pitch class of tonic (A=9, C=0)
  bpm:      number;
  bars:     number;
  moods:    string[];
  sections: string[]; // which sections this fragment suits
  notes:    NoteFragment[];
}

/** Extract mood words from filename like "A - i VII VI VII - Dark Mysterious.mid" */
function extractMoods(filename: string): string[] {
  // Everything after the last " - " before ".mid"
  const m = filename.replace(/\.mid$/i, '').match(/- ([^-]+)$/);
  if (!m) return [];
  return m[1].trim().split(/\s+/);
}

/** Parse filename to get the progression label */
function extractLabel(filename: string): string {
  // "A - i VII VI VII - Dark Mysterious.mid" → "i VII VI VII (Dark Mysterious)"
  const clean = filename.replace(/^[A-Za-z]+ - /, '').replace(/\.mid$/i, '');
  const parts = clean.split(' - ');
  if (parts.length >= 2) {
    return `${parts[0].trim()} (${parts.slice(1).join(' - ').trim()})`;
  }
  return clean;
}

function parseMidi(
  filePath: string,
  mode: 'minor' | 'major',
  rootPc: number,
): MidiFragment | null {
  const filename = basename(filePath);
  const moods = extractMoods(filename);
  const label = extractLabel(filename);

  // Decide which section(s) this fragment suits
  const sections = (Object.keys(SECTION_MOODS) as (keyof typeof SECTION_MOODS)[]).filter(sec =>
    moods.some(m => SECTION_MOODS[sec].includes(m))
  );
  if (sections.length === 0) return null; // doesn't fit any section

  let midi: InstanceType<typeof Midi>;
  try {
    const buf = readFileSync(filePath);
    midi = new Midi(new Uint8Array(buf));
  } catch (e) {
    console.warn(`  SKIP ${filename} — parse error: ${e}`);
    return null;
  }

  const bpm = midi.header.tempos[0]?.bpm ?? 120;
  const notes: NoteFragment[] = [];

  for (const track of midi.tracks) {
    for (const n of track.notes) {
      const startBeats = (n.time * bpm) / 60;
      const durBeats   = (n.duration * bpm) / 60;
      if (durBeats < 0.05) continue;
      notes.push({
        pitch: n.midi,
        start: Math.round(startBeats * 16) / 16,
        dur:   Math.max(0.0625, Math.round(durBeats * 16) / 16),
        vel:   Math.round(n.velocity * 127),
      });
    }
  }

  if (notes.length === 0) {
    console.warn(`  SKIP ${filename} — no notes`);
    return null;
  }

  const maxBeat = Math.max(...notes.map(n => n.start + n.dur));
  const bars    = Math.ceil(maxBeat / 4);

  const id = filename.replace(/\s+/g, '_').replace(/\.mid$/i, '').replace(/[^a-zA-Z0-9_-]/g, '');

  return { id, label, mode, rootPc, bpm, bars, moods, sections, notes };
}

function main() {
  const fragDir = join(process.cwd(), 'assets', 'midi-fragments');
  const out: MidiFragment[] = [];

  // Process minor (all in A minor, rootPc = 9)
  const minorDir = join(fragDir, 'minor');
  const minorFiles = readdirSync(minorDir).filter(f => f.toLowerCase().endsWith('.mid'));
  console.log(`Processing ${minorFiles.length} minor files…`);
  for (const f of minorFiles) {
    const frag = parseMidi(join(minorDir, f), 'minor', 9);
    if (frag) {
      out.push(frag);
      console.log(`  OK  ${frag.label.slice(0, 60).padEnd(60)} [${frag.sections.join(',')}]`);
    }
  }

  // Process major (all in A major, rootPc = 9)
  const majorDir = join(fragDir, 'major');
  const majorFiles = readdirSync(majorDir).filter(f => f.toLowerCase().endsWith('.mid'));
  console.log(`\nProcessing ${majorFiles.length} major files…`);
  for (const f of majorFiles) {
    const frag = parseMidi(join(majorDir, f), 'major', 9);
    if (frag) {
      out.push(frag);
      console.log(`  OK  ${frag.label.slice(0, 60).padEnd(60)} [${frag.sections.join(',')}]`);
    }
  }

  if (out.length === 0) {
    console.error('\nNo fragments parsed.');
    process.exit(1);
  }

  const outDir  = join(process.cwd(), 'assets');
  const outPath = join(outDir, 'midi-fragments.json');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  // Summary by section
  const bySec: Record<string, number> = {};
  for (const f of out) {
    for (const s of f.sections) bySec[s] = (bySec[s] || 0) + 1;
  }
  console.log(`\nWrote ${out.length} fragments → ${outPath}`);
  console.log('By section:', bySec);
}

main();
