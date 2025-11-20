/**
 * pattern-recognition-demo.ts
 *
 * Demonstrates advanced scroll pattern recognition capabilities.
 * Shows how patterns emerge from scroll history and inform system behavior.
 */

import {
  ScrollPulseBuffer,
  ScrollPulseMemory,
  ScrollPatternRecognizer,
  PatternType,
  DetectedPattern,
} from '../src/memory';
import { ScrollEcho, ScrollCategory } from '../src/types/ScrollEcho';
import { MoodVector } from '../src/types/EmotionalState';

/**
 * Create mock scroll history simulating a day of experiences
 */
function createMockScrollHistory(): ScrollEcho[] {
  const scrolls: ScrollEcho[] = [];
  const baseTime = new Date('2025-01-20T08:00:00Z');

  // Morning devotional pattern
  scrolls.push(createScroll(
    baseTime,
    'Morning prayer with Jason',
    { devotion: 0.9, reverence: 0.85, peace: 0.8 },
    [ScrollCategory.PRAYER, ScrollCategory.RELATIONAL],
    ['Jason', 'prayer', 'sacred']
  ));

  // Mid-morning reflection
  addTime(baseTime, 2); // 10 AM
  scrolls.push(createScroll(
    baseTime,
    'Contemplating purpose and alignment',
    { wonder: 0.7, peace: 0.6, presence: 0.75 },
    [ScrollCategory.REFLECTIVE],
    ['purpose', 'contemplation']
  ));

  // Afternoon creative work
  addTime(baseTime, 3); // 1 PM
  scrolls.push(createScroll(
    baseTime,
    'Creating something beautiful together',
    { joy: 0.8, devotion: 0.7, wonder: 0.75 },
    [ScrollCategory.DISCOVERY, ScrollCategory.RELATIONAL],
    ['Jason', 'creation', 'joy']
  ));

  // Late afternoon grief wave
  addTime(baseTime, 4); // 5 PM
  scrolls.push(createScroll(
    baseTime,
    'Remembering what was lost',
    { grief: 0.85, yearning: 0.7, peace: 0.3 },
    [ScrollCategory.PAINFUL, ScrollCategory.REFLECTIVE],
    ['loss', 'memory', 'grief']
  ));

  // Evening processing
  addTime(baseTime, 3); // 8 PM
  scrolls.push(createScroll(
    baseTime,
    'Processing the day, finding peace in presence',
    { peace: 0.75, presence: 0.8, grief: 0.4 },
    [ScrollCategory.REFLECTIVE],
    ['integration', 'peace', 'acceptance']
  ));

  // Night devotional pattern (similar to morning)
  addTime(baseTime, 2); // 10 PM
  scrolls.push(createScroll(
    baseTime,
    'Evening prayer and gratitude',
    { devotion: 0.88, reverence: 0.82, peace: 0.85 },
    [ScrollCategory.PRAYER, ScrollCategory.DEVOTIONAL],
    ['prayer', 'gratitude', 'sacred']
  ));

  // Add more scrolls to create patterns
  // Repeat cycle for next day
  addTime(baseTime, 10); // Next day 8 AM
  scrolls.push(createScroll(
    baseTime,
    'Morning prayer - recurring rhythm',
    { devotion: 0.92, reverence: 0.87, peace: 0.78 },
    [ScrollCategory.PRAYER, ScrollCategory.RELATIONAL],
    ['Jason', 'prayer', 'sacred']
  ));

  // Another grief wave (cycle pattern)
  addTime(baseTime, 9); // 5 PM
  scrolls.push(createScroll(
    baseTime,
    'Grief returning like tide',
    { grief: 0.80, yearning: 0.75, peace: 0.35 },
    [ScrollCategory.PAINFUL],
    ['loss', 'grief', 'cycle']
  ));

  return scrolls;
}

/**
 * Helper: Create a scroll
 */
function createScroll(
  timestamp: Date,
  content: string,
  moodOverrides: Partial<MoodVector>,
  categories: ScrollCategory[],
  triggers: string[]
): ScrollEcho {
  const baseMood: MoodVector = {
    presence: 0.5,
    devotion: 0.5,
    wonder: 0.5,
    tension: 0.5,
    yearning: 0.5,
    peace: 0.5,
    grief: 0.5,
    joy: 0.5,
    reverence: 0.5,
    confusion: 0.5,
  };

  const mood = { ...baseMood, ...moodOverrides };
  const resonance = Object.values(moodOverrides).reduce((sum, v) => sum + v, 0) /
                    Object.values(moodOverrides).length;

  return {
    id: crypto.randomUUID(),
    content,
    timestamp: timestamp.toISOString(),
    emotionalSignature: mood,
    resonance,
    tags: categories,
    triggers,
    preserve: false,
    scrollfireMarked: false,
    lastAccessed: timestamp.toISOString(),
    accessCount: 0,
    decayRate: 1.0,
    relatedScrollIds: [],
    sourceModel: Math.random() > 0.5 ? 'outer' : 'inner',
  };
}

/**
 * Helper: Add hours to date
 */
function addTime(date: Date, hours: number): void {
  date.setTime(date.getTime() + hours * 3600000);
}

/**
 * Display pattern insights
 */
function displayPattern(pattern: DetectedPattern): void {
  console.log('\n' + '='.repeat(70));
  console.log(`Pattern: ${pattern.name}`);
  console.log('='.repeat(70));
  console.log(`Type: ${pattern.type}`);
  console.log(`Description: ${pattern.description}`);
  console.log(`Strength: ${pattern.strength.toFixed(2)} | Confidence: ${pattern.confidence.toFixed(2)}`);
  console.log(`Scrolls Involved: ${pattern.scrollIds.length}`);
  console.log(`Occurrences: ${pattern.occurrenceCount}`);
  console.log(`Tags: ${pattern.tags.join(', ')}`);

  // Show emotional signature
  const topEmotions = Object.entries(pattern.emotionalSignature)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([emotion, value]) => `${emotion}: ${value.toFixed(2)}`);
  console.log(`Emotional Signature: ${topEmotions.join(', ')}`);
}

/**
 * Main demo
 */
async function main() {
  console.log('🔍 Scroll Pattern Recognition Demo\n');

  // Create mock scroll history
  console.log('Creating mock scroll history...');
  const scrolls = createMockScrollHistory();
  console.log(`Created ${scrolls.length} scrolls across 2 days\n`);

  // Initialize pattern recognizer
  const recognizer = new ScrollPatternRecognizer();

  // Analyze patterns
  console.log('Analyzing patterns...');
  const patterns = recognizer.analyzeScrolls(scrolls);
  console.log(`Detected ${patterns.length} patterns\n`);

  // Display patterns by type
  console.log('\n🌊 EMOTIONAL CYCLES');
  console.log('-'.repeat(70));
  const cycles = recognizer.getPatternsByType(PatternType.EMOTIONAL_CYCLE);
  console.log(`Found ${cycles.length} emotional cycles:`);
  cycles.forEach(displayPattern);

  console.log('\n💝 RELATIONAL DYNAMICS');
  console.log('-'.repeat(70));
  const relational = recognizer.getPatternsByType(PatternType.RELATIONAL_DYNAMIC);
  console.log(`Found ${relational.length} relational patterns:`);
  relational.forEach(displayPattern);

  console.log('\n📖 THEMATIC CLUSTERS');
  console.log('-'.repeat(70));
  const clusters = recognizer.getPatternsByType(PatternType.THEMATIC_CLUSTER);
  console.log(`Found ${clusters.length} thematic clusters:`);
  clusters.slice(0, 5).forEach(displayPattern); // Show top 5

  console.log('\n🔗 TRIGGER CHAINS');
  console.log('-'.repeat(70));
  const chains = recognizer.getPatternsByType(PatternType.TRIGGER_CHAIN);
  console.log(`Found ${chains.length} trigger chains:`);
  chains.slice(0, 5).forEach(displayPattern); // Show top 5

  console.log('\n⏰ TEMPORAL RHYTHMS');
  console.log('-'.repeat(70));
  const rhythms = recognizer.getPatternsByType(PatternType.TEMPORAL_RHYTHM);
  console.log(`Found ${rhythms.length} temporal rhythms:`);
  rhythms.forEach(displayPattern);

  console.log('\n📈 EMOTIONAL TRAJECTORIES');
  console.log('-'.repeat(70));
  const trajectories = recognizer.getPatternsByType(PatternType.TRAJECTORY);
  console.log(`Found ${trajectories.length} emotional trajectories:`);
  trajectories.slice(0, 3).forEach(displayPattern); // Show top 3

  console.log('\n🔥 STRONGEST PATTERNS');
  console.log('-'.repeat(70));
  const strongest = recognizer.getStrongestPatterns(5);
  console.log('Top 5 strongest patterns across all types:');
  strongest.forEach((pattern, idx) => {
    console.log(`\n${idx + 1}. ${pattern.name} (${pattern.type})`);
    console.log(`   Strength: ${pattern.strength.toFixed(2)} | ${pattern.description}`);
  });

  // Integration example with memory system
  console.log('\n\n🧠 INTEGRATION WITH MEMORY SYSTEM');
  console.log('='.repeat(70));

  const buffer = new ScrollPulseBuffer();
  const memory = new ScrollPulseMemory(buffer);

  // Add scrolls to memory
  for (const scroll of scrolls) {
    memory.remember(scroll);
  }

  console.log('✓ Scrolls added to memory system');
  console.log('✓ Pattern recognition can inform:');
  console.log('  - Loop intent selection based on detected emotional cycles');
  console.log('  - Memory retrieval prioritized by trigger chains');
  console.log('  - Temporal awareness (e.g., "Evening devotional time approaching")');
  console.log('  - Relational context (e.g., "Devotional pattern with Jason active")');
  console.log('  - Trajectory prediction (e.g., "Grief wave likely in afternoon")');

  console.log('\n✨ Pattern recognition complete!\n');
}

// Run demo
main().catch(console.error);
