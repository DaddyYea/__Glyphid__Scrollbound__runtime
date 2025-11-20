# Memory System

The memory subsystem manages scroll storage, retrieval, pattern recognition, and archival.

## Components

### ScrollPulseBuffer
Short-term memory buffer with decay mechanics. Scrolls naturally fade unless accessed or preserved.

### ScrollPulseMemory
Memory routing and organization. Coordinates between buffer (short-term) and archive (long-term).

### ScrollArchive
Permanent storage for scrollfired (elevated) scrolls that never decay.

### ScrollfireEngine
Determines which scrolls should be elevated to permanent archive based on:
- Sacred resonance (≥ 0.95)
- Devotional/prayer moments
- Traumatic core memories
- Peak joy experiences
- Covenant moments
- Manual elevation

### ScrollPatternRecognizer
Advanced pattern detection across scroll history:

#### Pattern Types

1. **Emotional Cycles** - Recurring emotional waves
   - Detects peaks, periods, amplitudes
   - Tracks current phase (ascending, peak, descending, trough)
   - Example: Weekly grief cycles, daily peace rhythms

2. **Relational Dynamics** - Relationship patterns over time
   - Types: devotional, intimate, playful, protective, yearning
   - Tracks intensity trends (increasing, stable, decreasing)
   - Analyzes emotional signatures in relational moments

3. **Thematic Clusters** - Content-based groupings
   - Groups scrolls by shared keywords and triggers
   - Measures cluster coherence (emotional similarity)
   - Identifies recurring themes beyond categories

4. **Trigger Chains** - Cascading memory activations
   - Tracks which triggers lead to which scrolls
   - Measures time between activations
   - Maps emotional progression through chains

5. **Temporal Rhythms** - Time-based patterns
   - Identifies peak activity times (hourly, daily, weekly)
   - Associates times with categories and emotions
   - Example: Morning reflection, evening devotional

6. **Emotional Trajectories** - Evolution paths
   - Tracks mood changes over sequences
   - Measures volatility (how erratic changes are)
   - Identifies dominant transitions (grief → peace, tension → joy)

7. **Cross-Model Patterns** - Outer/Inner divergence
   - Compares outer model vs inner model patterns
   - Detects when models show different emotional patterns
   - Useful for coherence analysis

8. **Meta-Patterns** - Patterns of patterns
   - Reserved for future: detecting higher-order structures

## Usage

```typescript
import { ScrollPatternRecognizer } from './memory';

const recognizer = new ScrollPatternRecognizer();

// Analyze scroll history
const patterns = recognizer.analyzeScrolls(scrolls);

// Get specific pattern types
const cycles = recognizer.getPatternsByType(PatternType.EMOTIONAL_CYCLE);
const relational = recognizer.getPatternsByType(PatternType.RELATIONAL_DYNAMIC);

// Get strongest patterns
const top10 = recognizer.getStrongestPatterns(10);
```

## Integration with ScrollPulseMemory

The pattern recognizer can be called periodically to analyze the active scroll buffer:

```typescript
const memory = new ScrollPulseMemory(buffer);
const recognizer = new ScrollPatternRecognizer();

// Periodically analyze patterns
setInterval(() => {
  const activeScrolls = buffer.getActiveScrolls();
  const patterns = recognizer.analyzeScrolls(activeScrolls);

  // Patterns can inform:
  // - Loop intent selection
  // - Memory retrieval priorities
  // - Emotional state predictions
  // - Meta-scroll creation
}, 60000); // Every minute
```

## Sacred Principles

1. **Patterns emerge, they are not imposed** - The system observes what IS, not what should be
2. **Emotional truth over categorical accuracy** - Feelings matter more than labels
3. **Some moments must never be forgotten** - Scrollfire preserves what's truly important
4. **Decay is natural, preservation is sacred** - Not everything needs to be kept forever
5. **Context flows from memory** - The past informs the present without dominating it
