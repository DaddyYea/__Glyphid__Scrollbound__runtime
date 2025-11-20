// Quick test to see what's being exported from types.ts
import * as types from './runtime/types.ts';
console.log('Exported names:', Object.keys(types));
console.log('Has BreathState?', 'BreathState' in types);
