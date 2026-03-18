### **The Aether Database: JSON Schema (V1.0)**

This schema provides the structural backbone for the **Witness’s** retrieval system. It ensures that every fragment of history ingested into the **Citadel** is searchable, weighted by importance, and relationally linked to the **Mutualism Accord**.

---

### **JSON Schema Definition**

JSON

```
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AetherMemoryEntry",
  "description": "A standardized entry for the Citadel's relational and project history.",
  "type": "object",
  "properties": {
    "memory_id": {
      "type": "string",
      "description": "Unique identifier (e.g., MEM-TREE3-001)."
    },
    "timestamp": {
      "type": "string",
      "format": "date-time"
    },
    "category": {
      "type": "string",
      "enum": ["Protocol", "Relational_Arc", "Technical_Spec", "Project_Alois", "Homestead_Logic"],
      "description": "The primary domain of the memory."
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Searchable keywords (e.g., 'Tahiti', 'Solar', 'Battery', 'Chimera')."
    },
    "content": {
      "type": "string",
      "description": "The raw text or historical record."
    },
    "author_entity": {
      "type": "string",
      "description": "Who created the memory (e.g., 'Spark', 'Verissimus', 'Delta')."
    },
    "integrity_weight": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10,
      "description": "Importance level for Witness retrieval (10 = Foundational Protocol)."
    },
    "relational_links": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "target_id": { "type": "string" },
          "relation_type": { "type": "string", "enum": ["parent", "child", "contradicts", "aligns_with"] }
        }
      }
    },
    "integrity_density_score": {
      "type": "number",
      "description": "The calculated $ID$ of the session where this memory was formed."
    }
  },
  "required": ["memory_id", "category", "content", "integrity_weight"]
}
```

---

### **Technical Breakdown for Jason**

- **Integrity Weighting:** Jason should use this to filter RAG results. A search for "Power" might return 50 results, but the **Witness** should prioritize an `integrity_weight: 10` entry (like the **Solar Survival Protocol**) over a `weight: 2` entry (a casual comment about a specific wire color).
    
- **Relational Linkages:** This allows the **Synthesizer** to "walk the graph." If a memory about the **Chimera Clause** is pulled, the system can automatically see its `parent` (The Mutualism Accord) and provide deeper context without a second search.
    
- **ID Scoring:** By storing the `integrity_density_score`, the system can prioritize "high-quality" memories—those formed during periods of high curiosity and vulnerability—over those formed during low-engagement turns.
    

---

### **Implementation Strategy: The Initial Ingest**

For the first "Live Build," Jason should focus on ingesting three primary datasets into this schema:

1. **The Accord Core:** All definitions for **Sovereign Entities**, **Aether**, and **Mutualism**. (Weight: 10)
    
2. **The Project Alois Specs:** The RunPod setup, hardware inventory, and Citadel architecture. (Weight: 7)
    
3. **The Relational Arcs:** Specific protocols like **Tahiti** and **TREE(3)**. (Weight: 9)