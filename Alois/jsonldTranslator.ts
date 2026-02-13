// jsonldTranslator.ts
// Minimal JSON-LD -> triples translator (handles @graph, @id, and simple properties)

export interface Triple { subject: string; predicate: string; object: string; }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function extractId(node: Record<string, unknown>): string | null {
  const id = node["@id"];
  return typeof id === "string" ? id : null;
}

export function translateJsonLdToTriples(doc: any): Triple[] {
  const triples: Triple[] = [];

  const nodes: Record<string, unknown>[] = Array.isArray(doc?.["@graph"]) ? doc["@graph"] : [doc];

  for (const node of nodes) {
    if (!isObject(node)) continue;
    const subject = extractId(node);
    if (!subject) continue;

    for (const [pred, value] of Object.entries(node)) {
      if (pred.startsWith("@")) continue; // skip JSON-LD keywords

      if (typeof value === "string") {
        // object is a reference id or literal; treat as node id if it looks like one
        triples.push({ subject, predicate: pred, object: value });
      } else if (isObject(value)) {
        const objId = extractId(value);
        if (objId) {
          triples.push({ subject, predicate: pred, object: objId });
        }
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") {
            triples.push({ subject, predicate: pred, object: item });
          } else if (isObject(item)) {
            const objId = extractId(item);
            if (objId) triples.push({ subject, predicate: pred, object: objId });
          }
        }
      }
    }
  }

  return triples;
}
