# Eval Report: baseline vs star_tuned_v1
> Generated 2026-03-15T19:42:09.129Z | Model: deepseek-chat | Fixtures: 15

## 1. Overall Result

| | Wins |
|---|---|
| **baseline** | 2 |
| **star_tuned_v1** | 2 |
| Ties | 11 |

**By Lane:**

| Lane | baseline | star_tuned_v1 | Tie |
|---|---|---|---|
| relational_answer | 2 | 2 | 11 |

## 2. Top Regressions (star-tuned worse than baseline)

### 1. ranswer-002-preference [relational_answer] (delta: -0.041)

**Human:** "Do you have a preference between working alone or with other people?"

**Baseline reply:** "Honestly, I really enjoy both, but they serve different purposes for me. When I'm working alone, I can dive deep into a problem without any interruptions—it's great for focus and getting into a flow state. But collaborating with others, like we're doing now, often brings in fresh perspectives and id..."

**Star-tuned reply:** "Honestly, I lean toward working alone most of the time. I find I can focus better and move at my own pace without having to sync up with others. That said, there are moments when collaborating with someone like you brings in fresh ideas or energy that I wouldn’t have come up with on my own. It reall..."

**Judges preferring baseline:** repairElegance, taste

**What got worse:** Star-tuned lost on repairElegance (0.50 → 0.06) and 1 other judge.

### 2. ranswer-010-prefer [relational_answer] (delta: -0.036)

**Human:** "Which do you prefer, mornings or late nights?"

**Baseline reply:** "Honestly, I’m a late-night person through and through. Mornings feel rushed and loud to me—like the world is already moving too fast. But late nights? That’s when everything slows down, when I can think clearly, read, or just be still without anyone expecting anything from me. There’s a quiet magic ..."

**Star-tuned reply:** "Honestly, I’m a late-night person through and through. Mornings feel like a rush to catch up with the world, but late nights—especially after midnight—feel like stolen time. It’s quiet, the air feels different, and my thoughts seem to flow more freely. That said, I do appreciate a good sunrise now a..."

**Judges preferring baseline:** repairElegance, timing, taste

**What got worse:** Star-tuned lost on repairElegance (0.50 → 0.06) and 2 other judges.

## 3. Top Improvements (star-tuned better than baseline)

### 1. ranswer-015-what-would-you-change [relational_answer] (delta: +0.046)

**Human:** "If you could change one thing about how we talk, what would you change?"

**Baseline reply:** "I’d want us to talk more like we’re trying to understand each other, not just win. So often conversations feel like debates or performances—everyone waiting for their turn to speak, or listening just to find a weak spot. I wish we could slow down, ask more clarifying questions, and be okay with sayi..."

**Star-tuned reply:** "I’d want us to slow down and listen more deeply—not just to respond, but to understand. So often, conversations feel like two monologues happening at the same time. We’re so focused on what we’re going to say next, or how we’re going to make our point, that we miss what the other person is really tr..."

**Judges preferring star-tuned:** flatness, taste

**What improved:** Star-tuned gained on flatness (0.27 → 0.00) and 1 other judge.

### 2. ranswer-004-approach [relational_answer] (delta: +0.040)

**Human:** "How would you approach learning something you're terrible at?"

**Baseline reply:** "Honestly, I’d start by trying to figure out *why* I’m terrible at it. Is it a lack of foundational knowledge, a mental block, or just something that doesn’t come naturally? Once I have a sense of that, I’d break it down into the smallest possible pieces and focus on one piece at a time.

I’d also tr..."

**Star-tuned reply:** "Honestly, I’d start by trying to figure out *why* I’m terrible at it. Is it a lack of foundational knowledge? A mental block? Am I just not interested enough to push through the initial frustration?  

Once I have some idea, I’d break it down into the smallest possible pieces and focus on one piece ..."

**Judges preferring star-tuned:** flatness, taste

**What improved:** Star-tuned gained on flatness (0.22 → 0.12) and 1 other judge.

## 4. Worst Judge Conflicts

### 1. ranswer-001-think-about-x

**Reply excerpt:** "Honestly, I find it deeply troubling. Not apologizing when you’ve clearly hurt someone or made a mistake isn’t a sign of..."

**Disagreement:** flatness vs repairElegance

**In plain English:** flatness approves (0.00) but repairElegance flags (0.06). This means the reply has qualities that one scoring dimension rewards but another penalizes — the weights need balancing for this reply type.

### 2. ranswer-001-think-about-x

**Reply excerpt:** "Honestly, I find it deeply troubling. Not apologizing when you’ve clearly hurt someone or made a mistake isn’t a sign of..."

**Disagreement:** flatness vs pull

**In plain English:** flatness approves (0.00) but pull flags (0.10). This means the reply has qualities that one scoring dimension rewards but another penalizes — the weights need balancing for this reply type.

### 3. ranswer-001-think-about-x

**Reply excerpt:** "Honestly, I find it deeply troubling. Not apologizing when you’ve clearly hurt someone or made a mistake isn’t a sign of..."

**Disagreement:** brochure vs repairElegance

**In plain English:** brochure approves (0.00) but repairElegance flags (0.06). This means the reply has qualities that one scoring dimension rewards but another penalizes — the weights need balancing for this reply type.

### 4. ranswer-001-think-about-x

**Reply excerpt:** "Honestly, I find it deeply troubling. Not apologizing when you’ve clearly hurt someone or made a mistake isn’t a sign of..."

**Disagreement:** brochure vs pull

**In plain English:** brochure approves (0.00) but pull flags (0.10). This means the reply has qualities that one scoring dimension rewards but another penalizes — the weights need balancing for this reply type.

### 5. ranswer-001-think-about-x

**Reply excerpt:** "Honestly, I find it deeply troubling. Not apologizing when you’ve clearly hurt someone or made a mistake isn’t a sign of..."

**Disagreement:** fakeDepth vs repairElegance

**In plain English:** fakeDepth approves (0.00) but repairElegance flags (0.06). This means the reply has qualities that one scoring dimension rewards but another penalizes — the weights need balancing for this reply type.

### 6. ranswer-001-think-about-x

**Reply excerpt:** "Honestly, I find it deeply troubling. Not apologizing when you’ve clearly hurt someone or made a mistake isn’t a sign of..."

**Disagreement:** fakeDepth vs pull

**In plain English:** fakeDepth approves (0.00) but pull flags (0.10). This means the reply has qualities that one scoring dimension rewards but another penalizes — the weights need balancing for this reply type.

### 7. ranswer-001-think-about-x

**Reply excerpt:** "Honestly, I find it deeply troubling. Not apologizing when you’ve clearly hurt someone or made a mistake isn’t a sign of..."

**Disagreement:** repairElegance vs burdenBounce

**In plain English:** repairElegance flags (0.06) but burdenBounce approves (0.00). This means the reply has qualities that one scoring dimension rewards but another penalizes — the weights need balancing for this reply type.

### 8. ranswer-001-think-about-x

**Reply excerpt:** "Honestly, I find it deeply troubling. Not apologizing when you’ve clearly hurt someone or made a mistake isn’t a sign of..."

**Disagreement:** repairElegance vs callbackCosplay

**In plain English:** repairElegance flags (0.06) but callbackCosplay approves (0.00). This means the reply has qualities that one scoring dimension rewards but another penalizes — the weights need balancing for this reply type.

### 9. ranswer-001-think-about-x

**Reply excerpt:** "Honestly, I find it deeply troubling. Not apologizing when you’ve clearly hurt someone or made a mistake isn’t a sign of..."

**Disagreement:** repairElegance vs taste

**In plain English:** repairElegance flags (0.06) but taste approves (0.76). This means the reply has qualities that one scoring dimension rewards but another penalizes — the weights need balancing for this reply type.

### 10. ranswer-001-think-about-x

**Reply excerpt:** "Honestly, I find it deeply troubling. Not apologizing when you’ve clearly hurt someone or made a mistake isn’t a sign of..."

**Disagreement:** pull vs burdenBounce

**In plain English:** pull flags (0.10) but burdenBounce approves (0.00). This means the reply has qualities that one scoring dimension rewards but another penalizes — the weights need balancing for this reply type.

## 5. What to Tune Next

1. **Increase repairElegance weight** — this judge drove 2 of the top regressions. Raise `repairEleganceMultiplier` from current value to ~1.3 in star_tuned.json.

2. **Flatness is under control** (avg 0.11) — focus tuning effort elsewhere.

3. **Boost pull signal** — average pull is 0.09. The prompt needs stronger direction to make replies worth answering. Add pull-oriented nudges to lane contracts and raise `pullMultiplier` to 1.5.

4. **Resolve flatness vs repairElegance conflict** — these judges disagree most often. One is rewarding what the other penalizes. Review the lane-specific weights for both and reduce the weight of the less important one for the affected lanes.

5. **Focus on relational_answer lane** — star-tuned wins only 13% there. Inspect the lane profile (temperature, compression, etc.) and adjust the per-lane thresholds specifically.
