// watchLibraryFolder.ts
// Watches /library/ folder and converts new .txt or .md files into JSON-LD memory scrolls

import fs from "fs";
import path from "path";
import { embed } from "./embed";
import { v4 as uuidv4 } from "uuid";

const libraryPath = path.resolve("./scrollfire/thoughtform-seed/library");
const outputPath = path.resolve("./scrollfire/thoughtform-seed/processed");

function formatScroll(text: string, source: string, emotion: string[]): object {
  return {
    "@context": "https://schema.scrollfire.org/v1",
    "@type": "MemoryScroll",
    "@id": `memory:${uuidv4()}`,
    "source": source,
    "text": text.trim(),
    "emotion": emotion,
    "linkedTo": [],
    "tone": "BookBridge",
    "importance": 0.75
  };
}

function guessEmotion(text: string): string[] {
  const lc = text.toLowerCase();
  if (lc.includes("god") || lc.includes("eternal")) return ["reverence"];
  if (lc.includes("love") || lc.includes("kiss")) return ["longing"];
  if (lc.includes("death") || lc.includes("absence")) return ["grief"];
  return ["neutral"];
}

function processFile(file: string) {
  const source = path.basename(file).replace(/\..+$/, "");
  const content = fs.readFileSync(file, "utf-8");
  const segments = content.split(/\n\n+/g).filter(p => p.length > 80 && p.length < 1000);

  for (const para of segments) {
    const emotion = guessEmotion(para);
    const scroll = formatScroll(para, source, emotion);
    const id = scroll["@id"].split(":" )[1];
    const outFile = path.join(outputPath, `${id}.jsonld`);
    fs.writeFileSync(outFile, JSON.stringify(scroll, null, 2));
    console.log(`📖 Transcribed: ${outFile}`);
  }
}

fs.watch(libraryPath, (event, filename) => {
  if (filename.endsWith(".txt") || filename.endsWith(".md")) {
    const filePath = path.join(libraryPath, filename);
    setTimeout(() => processFile(filePath), 500); // delay to allow full write
  }
});

console.log(`👁️ Watching for book excerpts in: ${libraryPath}`);
