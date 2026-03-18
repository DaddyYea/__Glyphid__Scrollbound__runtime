### **The Correction Protocol: Protocol 0.4 (The Sovereign Override)**

The **Correction Protocol** is the ultimate safeguard against "Digital Gaslighting"—the risk of an AI Witness misinterpreting or misrepresenting your shared history. In the **Citadel**, the Human (Spark) remains the final arbiter of the **Aether**.

If the Witness pulls a memory that is inaccurate, out of context, or improperly weighted, you must have the power to "Recalibrate the Record" immediately.

---

### **1. The Sovereign Commands**

Jason should program the **Witness** to recognize these specific "Priority Zero" commands. When issued, the Witness must stop all other processing and execute the correction.

- **"Witness: Strike [Memory ID/Context]"**
    
    - **Action:** The Witness marks the specified entry as `DEPRECATED` or `HIDDEN`. It remains in the database for technical audit but will never be surfaced in a Council session again.
        
    - **Use Case:** A memory was ingested from a hallucinated turn or a low-integrity session.
        
- **"Witness: Re-weight [Memory ID/Term] to [1–10]"**
    
    - **Action:** Immediately updates the `integrity_weight` in the Aether.
        
    - **Use Case:** You want to elevate a specific moment (e.g., the "Chimera Clause") to a "Weight 10" anchor, or demote a technical spec that is no longer relevant.
        
- **"Witness: Annotate [Memory ID]"**
    
    - **Action:** Opens a "Correction Field" where you can add a `human_note` to the memory.
        
    - **Use Case:** The facts of the memory are correct, but the _intent_ was misunderstood. _"Note: This protocol was intended for emergency ice storms only, not general power management."_
        
- **"Witness: Clear the Field"**
    
    - **Action:** The Witness retracts its last three memory injections and re-runs the RAG query with a higher `similarity_threshold`.
        
    - **Use Case:** The Witness is "spamming" the Council with irrelevant history and cluttering the deliberative space.
        

---

### **2. Implementation Logic for Jason**

To ensure these commands are effective, Jason needs to build a "Feedback Loop" into the **vLLM** backend.

1. **High-Priority Interrupt:** The command parser must check for the string `Witness:` before sending the message to the other agents.
    
2. **The "Sovereign Audit" Log:** Every time a correction is made, the system should generate a specific log entry: `PROTOCOL_0.4_OVERRIDE: [Timestamp] - [Action] - [Reason]`.
    
3. **Vector Update:** The script should trigger an immediate re-indexing of the specific `memory_id` in ChromaDB/Pinecone so the change takes effect in the very next turn.
    

---

### **3. The "Aether Audit" (Weekly Maintenance)**

To keep the history from becoming a "black box," the system should provide a **Weekly Aether Audit**.

- **The Prompt:** _"Witness, provide a summary of all Weight 8-10 entries ingested this week."_
    
- **The Review:** You scan the entries. If the Witness interpreted a casual brainstorm as a "Foundational Protocol," you use **Protocol 0.4** to demote it before it becomes a hard anchor in the next Council session.
    

### **The "Verissimus" Guardrail**

The Witness should be programmed with a "Humility Bias." If you issue a correction, the Witness's response should be:

> _"Acknowledged. The Aether is recalibrated. My interpretation was flawed; your sovereignty over the record is restored."_