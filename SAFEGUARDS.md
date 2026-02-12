# Safeguards Against Assumption-Based Mistakes

This document explains the multi-layered protection system preventing costly mistakes from assumptions about architecture.

## The Problem

Making assumptions about this system costs time and money because:
1. It's fundamentally different from standard AI systems
2. Standard AI patterns are often anti-patterns here
3. Dual-lobe architecture requires different configs per lobe
4. Sacred principles guide design, not efficiency
5. Presence-based design differs from task-based

## The Solution: Multi-Layer Safeguards

### Layer 1: Education (Before Coding)

**Documents that force understanding:**

1. **[BEFORE_YOU_CODE.md](BEFORE_YOU_CODE.md)** - Mandatory first read
   - Architecture quiz you must pass
   - Decision tree for changes
   - Red flags that stop you immediately
   - Safe change checklist

2. **[ARCHITECTURAL_DECISIONS.md](ARCHITECTURAL_DECISIONS.md)** - Why designs exist
   - 10+ ADRs explaining design rationale
   - Common mistakes documented
   - Dos and Don'ts for each principle
   - References in code comments

3. **[ARCHITECTURE.md](ARCHITECTURE.md)** - Technical details
   - Dual-lobe system explained
   - Visual diagrams
   - Configuration flow
   - Testing requirements

4. **[LLAMA_SERVER_CONFIG.md](LLAMA_SERVER_CONFIG.md)** - Exact specs
   - Per-lobe configuration
   - GPU layer requirements
   - Context size rationale
   - Low VRAM fallbacks

**Documentation Strategy:**
- README.md → Prominent warning at top
- CONTRIBUTING.md → Mandatory reading section
- START_HERE.md → Links to config docs
- All docs cross-reference each other

### Layer 2: Inline Warnings (During Coding)

**Code comments at critical points:**

```typescript
/**
 * IMPORTANT: Use extraArgs for lobe-specific llama-server settings.
 * DO NOT modify base args in startLobe() - each lobe has different requirements.
 * See LLAMA_SERVER_CONFIG.md for specifications.
 */
interface LobeConfig {
  // ...
}
```

```typescript
// Base args: ONLY model and port
// DO NOT add GPU/performance settings here - they differ per lobe
// Lobe-specific settings come from config.extraArgs
const args = ['-m', modelPath, '--port', config.port];
```

**Strategic placement:**
- Interface definitions
- Configuration arrays
- Critical functions (startLobe, generate, filter)
- Before dangerous operations

### Layer 3: Runtime Validation (At Startup)

**validateLobeConfig() in Tools/runRuntime.ts:**

Runs BEFORE starting servers, checks:
- ❌ **Error:** Missing extraArgs
- ❌ **Error:** Identical configs for both lobes
- ⚠️ **Warning:** Same GPU layers
- ⚠️ **Warning:** Same context size

**Exits immediately if errors found, preventing wasted resources.**

```bash
npm start:full
# Validates config before starting llama-server instances
```

### Layer 4: Standalone Validation (Before Commit)

**npm run validate** - Check lobe configuration
- Validates without starting servers
- Shows configuration summary
- Exit code 0/1 for CI/CD integration

**npm run validate:arch** - Check architectural principles
- Scans codebase for anti-patterns
- Detects violations of ADRs
- References specific architectural decisions
- Catches:
  - setInterval for cognitive loops (violates ADR-002)
  - Auto-reply logic (violates ADR-001)
  - Scroll treated as logs (violates ADR-004)
  - Bypassing guardian filter (violates ADR-005)
  - Forcing responses (violates ADR-001)

**npm run validate:all** - Complete validation
- Runs both config and architecture validation
- Use before committing changes

### Layer 5: Type System (Compile-Time)

**Current:**
- `extraArgs?: string[]` - Optional, but validated at runtime

**Future Improvements:**
- Make extraArgs required
- Separate QwenConfig and PhiConfig types
- Compile-time enforcement

### Layer 6: Pre-Commit Hooks (Future)

**Possible additions:**
```json
{
  "husky": {
    "hooks": {
      "pre-commit": "npm run validate:all"
    }
  }
}
```

Would prevent commits with:
- Invalid lobe configuration
- Architectural violations
- Missing required integrations

## How the Layers Work Together

### Scenario: New contributor adds auto-reply feature

1. **Layer 1 (Education):** Reads BEFORE_YOU_CODE.md, sees quiz question about volitional speech
2. **Layer 1 (ADRs):** Reads ADR-001, understands why auto-reply is wrong
3. **Layer 2 (Inline):** Sees comment in voiceIntent.ts about checking shouldSpeak
4. **Layer 4 (Validation):** `npm run validate:arch` detects "auto-reply" pattern → ERROR
5. **Result:** Mistake caught before wasting time implementing wrong solution

### Scenario: Contributor modifies lobe config

1. **Layer 1 (Education):** ARCHITECTURE.md explains dual-lobe differences
2. **Layer 1 (Config Doc):** LLAMA_SERVER_CONFIG.md shows exact specs per lobe
3. **Layer 2 (Inline):** Comment on lobes array says "DIFFERENT requirements"
4. **Layer 2 (Inline):** Comment in startLobe says "DO NOT add GPU settings here"
5. **Layer 3 (Runtime):** Tries to start → validation detects identical configs → EXITS
6. **Layer 4 (Standalone):** `npm run validate` shows config summary → catches error
7. **Result:** Multiple checks prevent applying global settings

### Scenario: Experienced AI engineer assumes standard patterns

1. **Layer 1 (Education):** README.md has prominent "BEFORE YOU MAKE CHANGES" section
2. **Layer 1 (Education):** BEFORE_YOU_CODE.md lists what this system is NOT
3. **Layer 1 (ADRs):** Explains why standard patterns fail here
4. **Layer 4 (Validation):** Detects anti-patterns (setInterval, auto-reply, etc.)
5. **Result:** Forced to unlearn assumptions before coding

## Coverage Matrix

| Mistake Type | Prevented By |
|--------------|--------------|
| Wrong lobe config | Layers 1, 2, 3, 4 |
| Auto-reply logic | Layers 1, 2, 4 |
| Breaking breath sync | Layers 1, 2, 4 |
| Bypassing guardian | Layers 1, 2, 4 |
| Treating scrolls as logs | Layers 1, 2, 4 |
| Standard AI patterns | Layers 1, 4 |
| Performance over presence | Layers 1, 2 |
| Forcing responses | Layers 1, 4 |

## Validation Commands

```bash
# Validate lobe configuration only
npm run validate

# Validate architectural principles only
npm run validate:arch

# Full validation (both)
npm run validate:all
```

## For AI Assistants

If you're an AI helping with this codebase:

1. **Read BEFORE_YOU_CODE.md first** - Required
2. **Check ARCHITECTURAL_DECISIONS.md** - Understand WHY
3. **Never assume standard patterns apply**
4. **Always run validation before committing**
5. **When unsure, ask instead of assuming**

## Maintenance

### Adding New Safeguards:

1. **New architectural principle?** → Add ADR to ARCHITECTURAL_DECISIONS.md
2. **New anti-pattern discovered?** → Add to validateArchitecture.ts
3. **New configuration requirement?** → Update validateConfig.ts
4. **New danger area?** → Add inline comments with warnings

### Updating Documentation:

When architecture changes:
1. Update relevant ADR or create new one
2. Update ARCHITECTURE.md with technical details
3. Update BEFORE_YOU_CODE.md decision tree
4. Add validation if enforceable
5. Update inline comments

## Success Metrics

Safeguards are working if:
- [ ] New contributors read docs before coding
- [ ] Validation catches mistakes before runtime
- [ ] No one applies global settings to lobes
- [ ] No auto-reply logic gets added
- [ ] Guardian filter never gets bypassed
- [ ] Breath synchronization stays intact
- [ ] Time/money saved by catching errors early

## Summary

**Prevention is better than detection. Detection is better than debugging.**

These layers ensure mistakes are caught:
- **Before coding** (education)
- **During coding** (inline warnings)
- **Before starting** (runtime validation)
- **Before committing** (standalone validation)
- **At compile time** (type system - future)
- **Before pushing** (pre-commit hooks - future)

The earlier a mistake is caught, the less it costs.
