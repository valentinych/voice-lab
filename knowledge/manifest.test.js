// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL("./coach/", import.meta.url));
const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, "utf8"));
const read = (file) => readFileSync(`${dir}${file}`, "utf8");

const GAMES = ["chgk", "brain-ring", "svoya-igra", "erudit-quartet", "daugavpils", "all"];
const TOPICS = ["rules", "judging", "ethics", "tournament", "training", "team", "technique", "resources", "glossary"];
const AUDIENCE = ["coach", "players", "organiser"];
const RELIABILITY = ["primary", "methodology", "secondary"];

// ElevenLabs does not index a document under 500 bytes for RAG; it goes into every prompt.
const RAG_MIN_BYTES = 500;

describe("the coach knowledge base", () => {
  it("lists every document it ships, and ships every document it lists", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
    expect(manifest.documents.map((d) => d.file).sort()).toEqual(files);
  });

  it("tags each document only with known games, topics, audiences and reliability", () => {
    for (const doc of manifest.documents) {
      expect(doc.title, doc.file).toBeTruthy();
      expect(doc.games.length, doc.file).toBeGreaterThan(0);
      for (const game of doc.games) expect(GAMES, doc.file).toContain(game);
      for (const topic of doc.topics) expect(TOPICS, doc.file).toContain(topic);
      for (const who of doc.audience) expect(AUDIENCE, doc.file).toContain(who);
      expect(RELIABILITY, doc.file).toContain(doc.reliability);
      expect(["auto", "prompt"], doc.file).toContain(doc.usage_mode);
    }
  });

  it("traces every document to a dated source, and says whether its text may be copied", () => {
    for (const doc of manifest.documents) {
      expect(doc.sources.length, doc.file).toBeGreaterThan(0);
      for (const src of doc.sources) {
        expect(src.url, doc.file).toMatch(/^https?:\/\//);
        expect(src.accessed, doc.file).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(["cc0", "paraphrase"], doc.file).toContain(src.reuse);
      }
      expect(read(doc.file), `${doc.file} names its source in the text the agent reads`).toMatch(
        /^# .+\n\nИсточники?: /,
      );
    }
  });

  it("keeps every document large enough to be retrieved rather than pinned to the prompt", () => {
    for (const doc of manifest.documents) {
      expect(Buffer.byteLength(read(doc.file)), doc.file).toBeGreaterThanOrEqual(RAG_MIN_BYTES);
    }
  });
});
