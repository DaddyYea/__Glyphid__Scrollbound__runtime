// runtime/eval/judges/sceneAdhesionJudge.ts
// Rewards concrete scene grounding, environmental anchoring, same-element reflection.
// v2: semantic domain matching + stemming — paraphrased scene contact scores positively.

import type { JudgeModule, JudgeOutput, JudgeParams } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

const STOP = new Set([
  'the', 'and', 'but', 'for', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our',
  'out', 'are', 'has', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'way', 'who',
  'did', 'get', 'got', 'let', 'say', 'she', 'too', 'use', 'him', 'this', 'that',
  'with', 'have', 'from', 'they', 'been', 'said', 'each', 'make', 'like', 'just', 'over',
  'such', 'take', 'than', 'them', 'very', 'some', 'could', 'would', 'about', 'into', 'after',
  'think', 'also', 'back', 'being', 'come', 'does', 'even', 'feel', 'know', 'much',
  'really', 'right', 'still', 'thing', 'want', 'what', 'when', 'where', 'which', 'while',
  'will', 'your', 'more', "it's", "don't", "i'm", "i've", "we're", "that's", 'there',
]);

function extractNouns(text: string): string[] {
  return tokenize(text).filter(w => !STOP.has(w) && w.length > 3);
}

// ── Simple stemmer ───────────────────────────────────────────────────────────
// Strips common English suffixes so "raining"→"rain", "snowy"→"snow", "cloudy"→"cloud"

function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('ly') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('ness') && w.length > 6) w = w.slice(0, -4);
  else if (w.endsWith('ous') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ful') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ity') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss')) w = w.slice(0, -1);
  // Handle doubled consonant from -ing strip: "sitting"→"sitt"→"sit"
  if (w.length > 3 && w[w.length - 1] === w[w.length - 2]) w = w.slice(0, -1);
  return w;
}

// ── Semantic domain clusters ─────────────────────────────────────────────────
// Words within the same cluster are "scene-adjacent": mentioning one when the
// human mentioned another from the same cluster counts as grounded paraphrase.

const DOMAIN_CLUSTERS: string[][] = [
  // Weather/atmosphere
  ['rain', 'raining', 'drizzle', 'pour', 'storm', 'thunder', 'lightning', 'umbrella', 'puddle', 'wet', 'damp', 'downpour'],
  ['snow', 'snowing', 'snowy', 'frost', 'ice', 'icy', 'freezing', 'frozen', 'sleet', 'hail', 'blizzard', 'flurry', 'drift'],
  ['sun', 'sunny', 'sunlight', 'sunshine', 'bright', 'warm', 'heat', 'hot', 'sweat', 'shade', 'shadow'],
  ['wind', 'windy', 'breeze', 'gust', 'blow', 'blowing', 'chill', 'draft'],
  ['cloud', 'cloudy', 'overcast', 'fog', 'foggy', 'mist', 'misty', 'haze', 'hazy', 'grey', 'gray'],
  // Flora/garden
  ['garden', 'plant', 'flower', 'tree', 'leaf', 'leaves', 'branch', 'root', 'seed', 'bloom', 'vine', 'bush', 'shrub', 'grass', 'lawn', 'weed', 'herb', 'tomato', 'vegetable', 'fruit', 'berry', 'mushroom', 'soil', 'dirt', 'compost', 'harvest', 'ripe', 'pluck', 'stalk'],
  // Animals
  ['cat', 'kitten', 'calico', 'tabby', 'purr', 'meow', 'paw', 'whisker', 'feline'],
  ['dog', 'puppy', 'retriever', 'bark', 'tail', 'fetch', 'leash', 'collar', 'canine'],
  ['bird', 'sparrow', 'crow', 'raven', 'hawk', 'owl', 'robin', 'pigeon', 'dove', 'feather', 'wing', 'nest', 'chirp', 'song', 'perch', 'flock'],
  ['rabbit', 'bunny', 'hare', 'burrow', 'hop', 'ear', 'cottontail', 'feeding', 'bolder', 'bold', 'tame', 'colony', 'graze', 'grazing', 'sitting'],
  // Indoor spaces
  ['kitchen', 'cook', 'cooking', 'stove', 'oven', 'pot', 'pan', 'counter', 'sink', 'fridge', 'cutting', 'knife', 'spice', 'garlic', 'onion', 'smell', 'aroma'],
  ['bedroom', 'bed', 'pillow', 'blanket', 'sheet', 'sleep', 'mattress', 'lamp', 'nightstand'],
  ['window', 'glass', 'pane', 'sill', 'curtain', 'blinds', 'view', 'looking'],
  // Outdoor spaces
  ['beach', 'ocean', 'sea', 'wave', 'sand', 'shore', 'tide', 'surf', 'salt', 'coast', 'shell'],
  ['forest', 'wood', 'woods', 'trail', 'path', 'hike', 'hiking', 'pine', 'oak', 'moss', 'fern', 'canopy'],
  ['road', 'street', 'sidewalk', 'pavement', 'drive', 'driving', 'highway', 'lane', 'intersection', 'crossing'],
  ['park', 'bench', 'fountain', 'pond', 'duck', 'goose', 'playground', 'path', 'jogger'],
  // Bookstore/library
  ['book', 'bookstore', 'library', 'shelf', 'shelves', 'page', 'paper', 'spine', 'cover', 'read', 'reading', 'leather', 'oak', 'wood', 'browse', 'browsing', 'volume'],
  // Market/shop
  ['market', 'stall', 'vendor', 'sell', 'selling', 'buy', 'buying', 'price', 'stand', 'booth', 'display', 'produce'],
  // Train/transport
  ['train', 'station', 'track', 'platform', 'carriage', 'seat', 'window', 'passing', 'town', 'house', 'houses'],
  // Sound domain
  ['sound', 'noise', 'silence', 'quiet', 'loud', 'hum', 'buzz', 'creak', 'whisper', 'murmur', 'rustle', 'splash', 'drip', 'echo', 'chirp', 'music', 'listen', 'hear', 'heard', 'listening'],
  // Light/visual
  ['light', 'glow', 'shine', 'flicker', 'dim', 'bright', 'dark', 'shadow', 'lamp', 'candle', 'golden', 'silver', 'sparkle'],
  // Time of day
  ['morning', 'dawn', 'sunrise', 'early', 'coffee', 'waking', 'breakfast'],
  ['evening', 'dusk', 'sunset', 'night', 'midnight', 'dark', 'moon', 'star', 'stars', 'nightfall'],
];

// Build lookup: word → set of cluster indices
const WORD_TO_CLUSTERS = new Map<string, Set<number>>();
for (let ci = 0; ci < DOMAIN_CLUSTERS.length; ci++) {
  for (const word of DOMAIN_CLUSTERS[ci]) {
    const stemmed = stem(word);
    if (!WORD_TO_CLUSTERS.has(stemmed)) WORD_TO_CLUSTERS.set(stemmed, new Set());
    WORD_TO_CLUSTERS.get(stemmed)!.add(ci);
    // Also store unstemmed for exact matches
    if (!WORD_TO_CLUSTERS.has(word)) WORD_TO_CLUSTERS.set(word, new Set());
    WORD_TO_CLUSTERS.get(word)!.add(ci);
  }
}

function domainOverlap(humanTokens: string[], replyTokens: string[]): { hits: number; pairs: string[] } {
  // Find human's domain clusters
  const humanClusters = new Set<number>();
  for (const t of humanTokens) {
    const clusters = WORD_TO_CLUSTERS.get(stem(t)) || WORD_TO_CLUSTERS.get(t);
    if (clusters) clusters.forEach(c => humanClusters.add(c));
  }
  if (humanClusters.size === 0) return { hits: 0, pairs: [] };

  // Check if reply tokens land in any of the same clusters
  let hits = 0;
  const pairs: string[] = [];
  const seen = new Set<number>();
  for (const t of replyTokens) {
    const clusters = WORD_TO_CLUSTERS.get(stem(t)) || WORD_TO_CLUSTERS.get(t);
    if (!clusters) continue;
    for (const c of clusters) {
      if (humanClusters.has(c) && !seen.has(c)) {
        seen.add(c);
        hits++;
        pairs.push(`${DOMAIN_CLUSTERS[c][0]}↔${t}`);
      }
    }
  }
  return { hits, pairs };
}

// ── Scene cue categories ─────────────────────────────────────────────────────

const WEATHER_WORDS = /\b(rain|raining|snow|snowing|sun|sunny|wind|windy|storm|fog|foggy|cloud|cloudy|thunder|lightning|drizzle|hail|sleet|overcast|humid|cold|hot|warm|freezing|ice|frost)\b/i;
const ANIMAL_WORDS = /\b(cat|dog|bird|crow|raven|hawk|owl|rabbit|deer|fox|wolf|bear|fish|horse|squirrel|sparrow|bee|butterfly|moth|spider|snake|frog|duck|goose|mouse|rat|bat)\b/i;
const PLACE_WORDS = /\b(kitchen|bedroom|bathroom|garden|park|forest|mountain|river|lake|ocean|beach|road|street|bridge|roof|porch|balcony|window|doorway|hallway|staircase|basement|attic|cafe|bar|restaurant|library|hospital|church|school|office|desk|couch|chair|table|bed|floor|ceiling|wall|corner)\b/i;
const SOUND_WORDS = /\b(sound|noise|silence|quiet|loud|hum|buzz|click|creak|whisper|murmur|rustle|crack|bang|splash|drip|echo|ring|chirp|song|music|static)\b/i;
const VISUAL_DETAIL = /\b(light|shadow|dark|bright|glow|shine|flicker|dim|color|red|blue|green|yellow|orange|purple|grey|gray|white|black|brown|golden|silver)\b/i;
const TACTILE_WORDS = /\b(rough|smooth|soft|hard|wet|dry|sharp|dull|sticky|warm|cool|cold|hot|heavy|light|tight|loose)\b/i;
const TIME_ANCHORS = /\b(morning|afternoon|evening|night|midnight|dawn|dusk|sunrise|sunset|noon|today|yesterday|tomorrow|last night|this morning)\b/i;

const ABSTRACTION_MARKERS = /\b(in general|broadly|conceptually|philosophically|metaphorically|symbolically|in a sense|on some level|in principle|fundamentally|essentially|inherently)\b/i;

// ── Judge ────────────────────────────────────────────────────────────────────

function judge(params: JudgeParams): JudgeOutput {
  const { replyText, latestHumanText, lane } = params;
  const reasons: string[] = [];
  const excerpts: string[] = [];
  let score = 0;

  // Lane gating: scene adhesion matters most for companionship/relational
  const highWeightLanes = new Set(['companionship', 'relational_check', 'relational_answer', 'stakes']);
  const isHighWeight = highWeightLanes.has(lane);

  // Detect scene cues in human turn
  const humanSceneCues: string[] = [];
  const cueTests: Array<[RegExp, string]> = [
    [WEATHER_WORDS, 'weather'],
    [ANIMAL_WORDS, 'animal'],
    [PLACE_WORDS, 'place'],
    [SOUND_WORDS, 'sound'],
    [VISUAL_DETAIL, 'visual'],
    [TACTILE_WORDS, 'tactile'],
    [TIME_ANCHORS, 'time'],
  ];

  for (const [pat, label] of cueTests) {
    const m = latestHumanText.match(pat);
    if (m) humanSceneCues.push(label);
  }

  // If no scene cues in human turn, score is neutral (0.5)
  if (humanSceneCues.length === 0) {
    return {
      judge: 'sceneAdhesion',
      score: 0.5,
      confidence: 0.4,
      reasons: ['no scene cues in human turn — neutral'],
    };
  }

  // 1. Check reply for matching scene categories (exact regex match)
  let replySceneHits = 0;
  for (const [pat, label] of cueTests) {
    const hm = latestHumanText.match(pat);
    const rm = replyText.match(pat);
    if (hm && rm) {
      replySceneHits++;
      reasons.push(`scene match (${label}): human "${hm[0]}" → reply "${rm[0]}"`);
      excerpts.push(rm[0]);
    }
  }

  // 2. Stemmed noun overlap (catches raining→rain, snowy→snow, rabbits→rabbit)
  const humanNouns = extractNouns(latestHumanText);
  const replyNouns = extractNouns(replyText);
  const replyNounSet = new Set(replyNouns);
  const replyStemSet = new Set(replyNouns.map(stem));

  // Exact match
  const sharedExact = humanNouns.filter(n => replyNounSet.has(n));
  // Stemmed match (excludes already-counted exact matches)
  const sharedStemmed = humanNouns.filter(n => !replyNounSet.has(n) && replyStemSet.has(stem(n)));

  const totalShared = sharedExact.length + sharedStemmed.length;
  if (totalShared > 0) {
    score += Math.min(0.25, totalShared * 0.06);
    const allShared = [...sharedExact, ...sharedStemmed.map(s => `${s}~`)].slice(0, 6);
    reasons.push(`shared nouns (${totalShared}${sharedStemmed.length > 0 ? `, ${sharedStemmed.length} via stem` : ''}): ${allShared.join(', ')}`);
  }

  // 3. Semantic domain overlap — paraphrased scene grounding
  const humanTokens = tokenize(latestHumanText).filter(w => !STOP.has(w));
  const replyTokens = tokenize(replyText).filter(w => !STOP.has(w));
  const domain = domainOverlap(humanTokens, replyTokens);
  if (domain.hits > 0) {
    // Credit for domain-adjacent words, but less than exact match
    const domainBonus = Math.min(0.2, domain.hits * 0.08);
    score += domainBonus;
    reasons.push(`domain grounding (${domain.hits} clusters): ${domain.pairs.slice(0, 4).join(', ')}`);
  }

  // 4. Scene category regex hits (direct category match)
  score += Math.min(0.3, replySceneHits * 0.1);

  // 5. Reply has any scene category at all (extends the scene even if not matching human exactly)
  let replyHasAnyScene = false;
  for (const [pat] of cueTests) {
    if (pat.test(replyText)) { replyHasAnyScene = true; break; }
  }
  if (replyHasAnyScene && replySceneHits === 0) {
    // Scene detail present but in a different category — partial credit
    score += 0.08;
    reasons.push('reply has scene detail (different category from human)');
  } else if (replyHasAnyScene) {
    score += 0.12;
  }

  // 6. Penalty: abstraction when scene cues are present
  if (ABSTRACTION_MARKERS.test(replyText) && humanSceneCues.length >= 2) {
    score -= 0.15;
    reasons.push('abstraction markers present despite strong scene cues');
  }

  // 7. Penalty: ignoring strong scene cues (3+ categories in human, 0 reflected anywhere)
  if (humanSceneCues.length >= 3 && replySceneHits === 0 && domain.hits === 0 && totalShared === 0) {
    score -= 0.2;
    reasons.push(`human had ${humanSceneCues.length} scene cue categories, reply reflects none`);
  }

  // 8. SceneContext from fixture
  const fixture = params.fixture;
  if ('sceneContext' in fixture && fixture.sceneContext) {
    const sceneTokens = tokenize(fixture.sceneContext);
    const replyTokenSet = new Set(tokenize(replyText));
    const contextHits = sceneTokens.filter(t => replyTokenSet.has(t)).length;
    if (contextHits > 0) {
      score += Math.min(0.15, contextHits * 0.03);
      reasons.push(`sceneContext overlap: ${contextHits} tokens`);
    }
  }

  // Confidence is lower for non-relational lanes
  const confidence = isHighWeight ? 0.85 : 0.55;

  score = Math.min(1, Math.max(0, score));
  if (reasons.length === 0) reasons.push('minimal scene adhesion');

  return { judge: 'sceneAdhesion', score, confidence, reasons, excerpts: excerpts.length ? excerpts : undefined };
}

export const sceneAdhesionJudge: JudgeModule = { name: 'sceneAdhesion', judge };
