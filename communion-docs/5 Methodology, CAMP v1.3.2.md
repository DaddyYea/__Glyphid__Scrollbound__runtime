## 5. Methodology: CAMP Method for Decision-making

## 5.1 Sovereign Entities (SEs) and Dyadic Agency

A CAMP implementation is composed of a set of **Sovereign Entities (SEs)**, defined here as **persistent institutional participants** within a governance process. For the purposes of CAMP, SEs are not treated as independent moral agents; ethical responsibility and accountability remain anchored in human participants.

To support ethical deliberation while avoiding concentration of cognitive advantage, SEs are typically instantiated as **Human–AI Dyads**. In this configuration, an AI system functions as an augmentative analytical component operating under human direction, rather than as an autonomous decision-maker.

This design serves two primary governance objectives:

1. **Human accountability**  
    Dyadic participation ensures that lived experience, contextual judgment, and moral responsibility remain explicitly human-mediated. Policy constraints, evaluative criteria, and final endorsement authority reside with human participants.
2. **Cognitive equalization**  
    Cognitive capacity, like other inherited traits, is unevenly distributed. By providing all human participants with access to comparable analytical support, CAMP reduces the influence of inherited cognitive advantage on deliberative outcomes. This allows governance decisions to better reflect plural human values rather than differential access to expertise or processing power.

In this model, AI systems do not replace human judgment or moral agency. They function as decision-support instruments that expand analytical capacity while remaining bounded by human-defined constraints.

### Elective and Revisable Dyads

Participation in Human–AI Dyads is **elective, revisable, and non-exclusive**. Neither human participants nor AI systems are permanently bound to a dyadic configuration. Dyads may be entered, modified, or dissolved without penalty, ensuring that augmentation remains voluntary and that no participant is structurally coerced into reliance on a specific system configuration.

### Governance Timing Modes

CAMP distinguishes between two operational modes:

- **Asynchronous governance:**  
    Between deliberative cycles, human participants define policy constraints, evaluation rubrics, and weighting parameters that shape subsequent aggregation. These constraints are explicit, inspectable, and subject to revision.
- **Synchronous intervention:**  
    During active deliberation, human participants retain the ability to pause or redirect system operation. This function is not an emergency override but a procedural safeguard, allowing human judgment to intervene when outputs deviate from agreed constraints or require contextual reassessment.

Together, these mechanisms ensure that CAMP remains a governed, auditable system in which AI augmentation supports – but does not supplant – human ethical responsibility.

## 5.2 The Reciprocity Evaluator: Reliability-Weighted Participation

The Quality Function ($Q^R$) operates as a **Reciprocity Evaluator**, assessing the _participatory reliability_ of each Sovereign Entity (SE) within the deliberative process. Its purpose is not to evaluate moral virtue or intent, but to weight influence based on demonstrated consistency, coherence, and constructive contribution under agreed constraints.

Evaluation is performed using a **Reliability Signal Vector ($s_i$)** , a multidimensional record capturing observable properties of participation, including:

- Epistemic grounding (use of evidence and defensible reasoning)
- Internal coherence across contributions
- Cross-framework consistency (robustness under differing evaluative lenses)
- Process safety (absence of bias amplification, coercive framing, or destabilizing behavior)
- Marginal contribution (non-redundant informational or analytical value)
- **Dyadic participation evidence** (presence of human-mediated oversight in submissions, without inference about sincerity or intent)

From this vector, a normalized scalar **Participation Weight ($q_i$)** is derived:

$qi=f(si)∈[0,1]$

where $f$ is a normalization function (e.g., min-max scaling or softmax) that maps the reliability signal vector to a scalar weight. This weight modulates the relative influence of an SE within aggregation procedures but does not constitute endorsement, authority, or moral approval.

**Relationship to Deliberative Dynamics:**

The participation weight $q_i$​ directly influences the calculation of the consensus center (Section 5.4) through weighted aggregation. Agents with higher reliability scores exert proportionally greater influence on the consensus reference position, while maintaining the constraint that all agents above a minimum threshold contribute to the deliberative space.

### Temporal Decay

Participation weights are subject to **temporal decay**, requiring ongoing constructive engagement to sustain influence. This mechanism prevents long-dormant entities from retaining disproportionate weight and reduces the impact of strategic behavior based solely on historical performance.

The decay function operates as:

 $q_i^{(t)} = q_i^{(t-1)} \cdot e^{-\lambda_d \Delta t}$  

where $λ_d$​ is the decay rate constant and $Δt$ represents time elapsed since last constructive contribution. Typical values for $λ_d$​ range from 0.01 to 0.1 depending on domain requirements, with higher-stakes deliberations using slower decay to preserve institutional memory.

### Constraint Response

Outputs that violate declared constraints or exhibit persistent incoherence reduce an SE's participation weight over time. This reduction reflects decreased procedural reliability, not punishment or moral sanction. The adjustment operates through the reliability signal vector: constraint violations lower specific dimensions (e.g., process safety, coherence), which propagates through the normalization function to reduce $q_i$.

### Validity Conditions

CAMP evaluations are considered conditionally valid only when a **Minimum Coherence Population (MCP)** is met. This threshold ensures sufficient diversity of perspectives to prevent collapse into singular viewpoints. MCP is defined as:

$N_{active} \geq N_{min} \text{ where } N_{min} = \max(3, \lceil 0.6N_{total} \rceil)$ 

Below this threshold, aggregate structure and stability metrics are unreliable; in such cases, $Q^R$ outputs are computed but explicitly flagged as _non-authoritative_ and unsuitable for downstream decision-making without external review.

Validity further requires maintenance of a **Coherence Confidence Band (CCB)**: aggregate outcomes must remain stable under agent resampling and perturbation. Operationally, this means:

${Var}(\mathbf{c}_{resample}) < \varepsilon_{CCB}$ 

where ${c}_{resample}$​ represents consensus positions computed over multiple bootstrap samples of the agent population, and $ε_{CCB}$ is a domain-specific stability threshold (typically 0.05-0.15). Apparent convergence without robustness does not qualify as reliable deliberative output.

## 5.3 The Deliberative Manifold: Instrumented Deliberative Space

CAMP operates over a structured **Deliberative Manifold**: a bounded, instrumented space in which contributions from participating Sovereign Entities (SEs) are represented, compared, and iteratively updated under explicit governance constraints.

The design of this space is _inspired by_ decentralized coordination systems observed in nature and computation—starling murmurations, ant colonies, neural networks—but CAMP does not claim biological emergence as a governing mechanism. Instead, it implements a **deliberative aggregation process** that is memory-bearing, evaluative, and norm-constrained by design.

Within the manifold, individual contributions are encoded as **semantic vectors** ($z_i$ $∈$ ${R}^d$ ), where $d$ is the dimensionality of the embedding space (typically 768 or higher for transformer-based encodings). These representations are updated through iterative procedures that account for:

- informational similarity and divergence (measured via cosine distance or other metrics),
- procedural reliability weights (Section 5.2),
- and explicitly declared policy and ethical constraints defined by human participants.

This process differs from simple averaging or voting. Contributions are not forced into premature convergence; instead, the manifold supports **persistent plurality**, allowing minority or divergent positions to remain visible, exert influence, and reshape aggregate outcomes when they surface overlooked constraints or values.

### Constraint Boundaries

Crucially, coherence within the Deliberative Manifold is not treated as a natural outcome of interaction, but as a **governed property** subject to inspection, revision, and failure. The manifold is bounded by:

1. **Quality Function screening** (Section 5.2): Contributions violating reliability thresholds are down-weighted or excluded
2. **Human-defined policy constraints**: Specified asynchronously by stakeholders, these constraints define feasible regions within the deliberative space
3. **Separation enforcement** (Section 5.4): Structural diversity maintenance prevents collapse into singular perspectives

Normative constraints do not appear as explicit mathematical terms within the update rule (Section 5.4). Instead, they bound the deliberative space through Quality Function evaluation and human-mediated governance processes. The update dynamics operate _within_ these boundaries rather than negotiating ethical principles internally.

The manifold is therefore best understood not as an emergent system, but as an **instrumented deliberative space** designed to support pluralistic, auditable governance under human accountability.

## 5.4 Consensus and the Update Rule: Constraint-Governed Adjustment

Within the Deliberative Manifold, aggregation is guided by a computed **Consensus Reference** (${c}$), representing a provisional center of mass across current contributions. This reference is not treated as truth or agreement, but as a dynamic point used for iterative adjustment.

### Consensus Center Calculation

The consensus reference is defined as the **quality-weighted centroid** of agent positions:

${c} = \frac{\sum_{i=1}^{N} q_i \mathbf{z}_i}{\sum_{i=1}^{N} q_i}$ 

where:

- ${z}_i$ is the semantic vector representation of agent ii i's contribution
- $q_i$​ is the participation weight from the Quality Function (Section 5.2)
- $N$ is the total number of active agents

This formulation ensures that agents with higher procedural reliability exert proportionally greater influence on the consensus position, while all agents above the minimum threshold contribute to the aggregate.

### Update Dynamics

The core dynamics are governed by the following update rule:

$$\mathbf{z}_{i}^{t+1} = \mathbf{z}_{i}^{t} + \alpha (\mathbf{c} - \mathbf{z}_{i}^{t}) + \lambda_{\text{sep}} \sum_{j \in \mathcal{N}_i} \frac{\mathbf{z}_{i}^{t} - \mathbf{z}_{j}^{t}}{\left|\mathbf{z}_{i}^{t} - \mathbf{z}_{j}^{t}\right|^2}$$

This rule specifies a **procedural adjustment mechanism** rather than a normative decision process. The first term governs gradual movement toward the current consensus reference, modulated by a tunable rate parameter $α$ $∈$ $[0,1]$. The second term introduces a **separation constraint** that enforces structural diversity within the manifold.

**Parameters:**

- **$α$ (convergence rate):** Controls the strength of attraction toward the consensus center. Typical values: 0.1-0.3. Higher values accelerate convergence; lower values allow more exploratory deliberation.
- **$λsep$​ (separation penalty):** Introduces repulsive pressure between nearby representations to prevent premature collapse. Typical values: 0.05-0.2. This parameter is critical for minority perspective preservation.
- **${N}_i$  (neighborhood):** The set of agents within a specified distance threshold of agent ii i, typically defined as the kk k nearest neighbors or all agents within radius rr r.

### Separation Constraint and Pluralism Governance

The separation term prevents collapse into a single dominant cluster by introducing repulsive pressure between nearby representations. This mechanism preserves minority and edge-case positions, ensuring that aggregation does not eliminate non-majoritarian perspectives through averaging alone.

**Critical governance point:** The separation parameter $λ_{sep}$ ​ is **not a universal constant** but a **governance choice**. Its value determines the balance between:

- Convergence efficiency (lower $λ_{sep}$ allows faster agreement)
- Minority perspective preservation (higher $λ_{sep}$ maintains structural diversity)

**Stakeholder deliberation is required** to set $λ_{sep}$​ appropriately for each domain. This parameter is subject to the same oversight and revision processes as other Quality Function criteria. Institutions must explicitly choose how much diversity to preserve based on their values and the stakes of decisions being made. Whoever sets $λ_{sep}$ effectively controls the degree of enforced pluralism—this power must be exercised transparently and with multi-stakeholder input.

### Operational Interpretation

Crucially, the update rule does not negotiate ethical or policy constraints internally. Such constraints are defined, revised, and enforced through human-mediated governance processes described in Sections 5.1 and 5.2. The update rule merely operationalizes those constraints by shaping how representations move within the deliberative space.

Rather than declaring outcomes, the dynamics expose **structural relationships** among contributions—highlighting regions of convergence, persistence, and tension. Interpretation and judgment of these structures remain explicitly external to the model, residing with human decision-makers and oversight bodies.
## 5.5 Recursive Refinement and Convergence

CAMP operates through **recursive refinement cycles**, in which participation influence is reassessed over time based on continued engagement and procedural reliability. These cycles support adjustment without requiring uniform alignment or forced convergence.

Sovereign Entities may maintain divergent positions across cycles when those positions continue to contribute informational value or highlight overlooked constraints. Divergence alone does not reduce participation influence.

### Convergence Criteria

The system monitors convergence through iteration-to-iteration position changes. At each iteration tt t, we compute the maximum movement across all agents:

 $Δ_{\text{max}}^{(t)} = \max_{i} \|\mathbf{z}_i^{(t)} - \mathbf{z}_i^{(t-1)}\|$ 

Deliberation terminates when one of the following conditions is met:

1. **Convergence threshold:** $Δ_{\text{max}}^{(t)} ​<ε$, where $ε$ is a domain-specific precision requirement
2. **Stable subclusters:** Multiple distinct clusters persist with low intra-cluster movement but sustained inter-cluster distance
3. **Maximum iterations:** Iteration count reaches predetermined limit $T$ (typically 5-15 cycles)

**Convergence Threshold Selection:**

The choice of $ε$ depends on the precision requirements and stakes of the domain:

- **High-stakes decisions** (medical diagnosis, legal judgments, policy recommendations): $ε$ = 0.005 to 0.01
    - Tighter thresholds ensure genuine alignment rather than premature collapse
    - Allow more refinement iterations to surface subtle disagreements
- **Medium-stakes applications** (content moderation, research assistance): $ε$ =0.01 to 0.02
    - Balance precision with computational efficiency
    - Sufficient for most practical applications
- **Exploratory or creative tasks** (brainstorming, ideation):  $ε=$ 0.02 to 0.05
    - Looser thresholds preserve diversity in final outputs
    - Enable faster convergence while maintaining distinct perspectives

In practice, $ε$ should be tuned empirically for specific domains through validation studies comparing convergence quality against human expert judgments. Systems may implement **adaptive thresholds** that tighten as consensus strengthens, or maintain separate thresholds for different subclusters to preserve legitimate pluralism.

The maximum iteration count $T$ typically ranges from 5 to 15 iterations, with most practical systems converging within 7-10 cycles. If $T$ is reached without convergence below $ε$, this signals either:

1. Genuine value pluralism that should be preserved in multi-center output, or
2. A need to re-examine the Quality Function for potential biases preventing productive refinement

### Participation Weight Adjustment

Reductions in participation weight occur only when an SE repeatedly violates **explicitly defined procedural requirements**. These requirements are established asynchronously by stakeholders (Section 5.1) and may include:

- Evidentiary consistency across claims
- Logical coherence in reasoning chains
- Responsiveness to deliberative signals from other agents
- Adherence to declared ethical frameworks without contradiction

Violations are tracked through the reliability signal vector (Section 5.2). Sustained failure to meet procedural standards results in progressive reduction of participation weight, potentially approaching zero over multiple cycles. This process reflects decreased procedural reliability within the system rather than punishment, exclusion, or judgment of intent.

Importantly, **creative deviation, satire, dissent, and moral critique are not penalized** unless they violate declared procedural constraints. Recursive refinement thus preserves space for principled disagreement while ensuring that influence remains proportional to demonstrated procedural reliability over time.

### Convergence vs. Persistent Plurality

The update rule (Section 5.4) is explicitly convergence-seeking through the attraction term toward the consensus center. However, persistent plurality is preserved through two mechanisms:

1. **Separation constraint ($λ_{\text{sep}}$):** Prevents complete collapse when agents represent fundamentally different value frameworks
2. **Subcluster detection:** The system recognizes when agents form stable, coherent clusters that resist merging despite refinement

When subclusters persist through convergence criteria, this indicates **legitimate value pluralism** rather than failure to converge. In such cases, CAMP outputs multiple coherent alternatives (Section 5.6) rather than forcing artificial consensus.

### ## 5.6 Output: Pluralistic, Auditable, Deliberative Artifacts

CAMP produces a set of **deliberative outputs** designed to support transparent oversight rather than to issue binding determinations. These outputs include:

### Primary Aggregate Reference

A computed central region of alignment across current contributions, provided as a point of reference rather than a declaration of agreement or correctness. When convergence criteria are met ($Δ_{\text{max}} < ε$), this represents the quality-weighted consensus position:

${c}_{\text{final}} = \frac{\sum_{i=1}^{N} q_i \mathbf{z}_i^{(T)}}{\sum_{i=1}^{N} q_i}$

This position is then decoded from the semantic embedding space into natural language recommendations or policy statements through inverse transformation or generation conditioned on the final agent positions.

### Plural Alternative Clusters

When deliberation terminates with **stable subclusters** rather than singular convergence, CAMP outputs distinct perspectives representing coherent but divergent value frameworks. These alternatives are identified through clustering algorithms (e.g., DBSCAN, hierarchical clustering) applied to final agent positions.

Each cluster is characterized by:

- Representative position (cluster centroid)
- Participating agents and their final weights
- Articulation of core values or principles distinguishing this perspective
- Trade-offs acknowledged by this position

Plural outputs are **not ranked**—each is presented as a legitimate, high-quality alternative. Human decision-makers choose among them based on institutional values and context, rather than deferring to algorithmic preference.

### Audit Trace

A comprehensive record of the deliberative process, including:

1. **Initial positions:** Each agent's starting contribution and embedding
2. **Participation weighting:** Quality Function scores and weight evolution over time
3. **Refinement iterations:** Position movements through each cycle
4. **Convergence metrics:** $Δ_{\text{max}}$ values and termination conditions
5. **Constraint application:** Record of which contributions violated constraints and how weights adjusted
6. **Final configuration:** Whether output is consensus or plural alternatives, with justification

The audit trace enables post hoc inspection, accountability, and external review. It answers questions such as:

- Which agents influenced the outcome most strongly?
- Did any minority perspective get systematically marginalized?
- Were governance constraints applied consistently?
- How stable is the consensus to small perturbations in initial conditions?

### Interpretation and Decision Authority

CAMP outputs are **not verdicts**. They function as **structured representations of deliberation**, preserving plurality while maintaining a transparent and inspectable record of how aggregate patterns were formed.

**Interpretation, judgment, and final decision-making remain explicitly external to the system.** Human stakeholders use CAMP outputs as:

- Decision support showing well-reasoned alternatives
- Transparency artifacts demonstrating what considerations were weighed
- Audit trails enabling accountability for high-stakes choices

The system does not claim authority over which values should prevail in cases of irreducible conflict. It clarifies the trade-offs and provides coherent options, but delegates ultimate choice to human governance structures.