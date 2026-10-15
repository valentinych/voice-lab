/**
 * One command for a local coach, reading worker/.dev.vars. Safe to rerun: what is already
 * right is reused.
 *
 * With ELEVENLABS_API_KEY it brings the coach's agent in line with the page, then runs the
 * Worker and the page against each other. With only an interview key, VIBE_TOKEN, the
 * agent cannot be touched: the deployed Worker mints the session and the local one serves
 * the training questions, which the page puts into the prompt.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { CLIENT_TOOL, coachConversationConfig, KB_PREFIX, kbName, PLATFORM_SETTINGS } from "./coachAgent.mjs";

const root = new URL("../", import.meta.url);
const path = (p) => new URL(p, root);
const API = "https://api.elevenlabs.io";
const LOCAL_KEY = "vibe_dev";
const WRANGLER = ["--yes", "wrangler@4"];

function devVar(name) {
  let text = "";
  try {
    text = readFileSync(path("worker/.dev.vars"), "utf8");
  } catch {
    // Missing file reads as a missing key.
  }
  return text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "") ?? "";
}

const apiKey = devVar("ELEVENLABS_API_KEY");
const vibeToken = devVar("VIBE_TOKEN");
if (apiKey.startsWith("vibe_")) {
  console.error("В ELEVENLABS_API_KEY лежит интервью-ключ. Впишите его в worker/.dev.vars как VIBE_TOKEN=vibe_...");
  process.exit(1);
}
if (!apiKey && !vibeToken) {
  console.error("Впишите в worker/.dev.vars ключ ElevenLabs (ELEVENLABS_API_KEY=sk_...) или интервью-ключ (VIBE_TOKEN=vibe_...).");
  process.exit(1);
}

async function api(method, route, body) {
  const isForm = body instanceof FormData;
  const r = await fetch(`${API}${route}`, {
    method,
    headers: { "xi-api-key": apiKey, ...(body && !isForm ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${route} → ${r.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

const tomlPath = path("worker/wrangler.toml");
let toml = readFileSync(tomlPath, "utf8");
const tomlVar = (name) => toml.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, "m"))?.[1];

async function ensureTool() {
  const query = new URLSearchParams({ search: CLIENT_TOOL.tool_config.name, page_size: "100" });
  const { tools = [] } = await api("GET", `/v1/convai/tools?${query}`);
  const existing = tools.find((t) => t.tool_config?.name === CLIENT_TOOL.tool_config.name);
  if (existing) {
    await api("PATCH", `/v1/convai/tools/${existing.id}`, CLIENT_TOOL);
    return existing.id;
  }
  const { id } = await api("POST", "/v1/convai/tools", CLIENT_TOOL);
  console.log(`  создан инструмент ${CLIENT_TOOL.tool_config.name}`);
  return id;
}

async function uploadedDocs() {
  const docs = [];
  let cursor;
  do {
    const query = new URLSearchParams({ search: KB_PREFIX, page_size: "100", ...(cursor ? { cursor } : {}) });
    const page = await api("GET", `/v1/convai/knowledge-base?${query}`);
    docs.push(...(page.documents ?? []));
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return docs;
}

async function ensureKnowledgeBase() {
  const manifest = JSON.parse(readFileSync(path("knowledge/coach/manifest.json"), "utf8"));
  const existing = await uploadedDocs();
  const locators = [];
  for (const doc of manifest.documents) {
    const text = readFileSync(path(`knowledge/coach/${doc.file}`), "utf8");
    const name = kbName(doc.file, createHash("sha256").update(text).digest("hex"));
    let id = existing.find((d) => d.name === name)?.id;
    if (!id) {
      const form = new FormData();
      form.append("file", new Blob([text], { type: "text/markdown" }), doc.file);
      form.append("name", name);
      ({ id } = await api("POST", "/v1/convai/knowledge-base/file", form));
      console.log(`  загружен ${doc.file}`);
    }
    locators.push({ type: "file", id, name, usage_mode: doc.usage_mode ?? "auto" });
  }
  return locators;
}

async function ensureCoachAgent() {
  const toolId = await ensureTool();
  const knowledgeBase = await ensureKnowledgeBase();
  const coachId = tomlVar("COACH_AGENT_ID");

  if (coachId) {
    const current = await api("GET", `/v1/convai/agents/${coachId}`);
    await api("PATCH", `/v1/convai/agents/${coachId}`, {
      conversation_config: coachConversationConfig(current.conversation_config, { toolId, knowledgeBase }),
      platform_settings: PLATFORM_SETTINGS,
    });
    console.log(`  агент тренера ${coachId} обновлён`);
    return;
  }

  // The coach gets its own agent: its knowledge base on the shared one would reach general talk.
  const shared = await api("GET", `/v1/convai/agents/${tomlVar("AGENT_ID")}`);
  const { agent_id } = await api("POST", "/v1/convai/agents/create", {
    name: "voice-lab coach",
    conversation_config: coachConversationConfig(shared.conversation_config, { toolId, knowledgeBase }),
    platform_settings: PLATFORM_SETTINGS,
  });
  toml = toml.replace(/^# COACH_AGENT_ID = .*$/m, `COACH_AGENT_ID = "${agent_id}"`);
  if (tomlVar("COACH_AGENT_ID") !== agent_id) throw new Error(`впишите COACH_AGENT_ID = "${agent_id}" в worker/wrangler.toml`);
  writeFileSync(tomlPath, toml);
  console.log(`  создан агент тренера ${agent_id}, записан в worker/wrangler.toml`);
}

if (apiKey) {
  console.log("ElevenLabs: настраиваю агента тренера…");
  await ensureCoachAgent();
} else {
  console.log("Без ключа ElevenLabs: агент не меняется, вопросы придут в промпте, сессию выдаёт развёрнутый Worker.");
}

const pageKey = apiKey ? LOCAL_KEY : vibeToken;
console.log("Локальный ключ доступа…");
// Piped, not inherited: wrangler echoes the key it writes.
const put = spawnSync(
  "npx",
  [...WRANGLER, "kv", "key", "put", "--binding", "KEYS", "--local", `key:${pageKey}`, JSON.stringify({ engine: "elevenlabs", label: "local" })],
  { cwd: path("worker"), encoding: "utf8" },
);
if (put.status !== 0) {
  console.error(put.stderr.replaceAll(pageKey, "<key>"));
  process.exit(put.status ?? 1);
}

const deployedWorker = readFileSync(path("src/lib/config.ts"), "utf8").match(/DEFAULT_WORKER_URL = "([^"]+)"/)[1];
const pageEnv = apiKey
  ? { VITE_WORKER_URL: "http://localhost:8787" }
  : { VITE_WORKER_URL: `${process.env.BASE_PATH ?? "/voice-lab/"}worker`, VOICE_LAB_WORKER_PROXY: deployedWorker };

const children = [
  spawn("npx", [...WRANGLER, "dev", "--port", "8787"], { cwd: path("worker"), stdio: "inherit" }),
  spawn("npx", ["vite"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...pageEnv, VITE_VIBE_TOKEN: pageKey },
  }),
];
console.log("\nОткройте http://localhost:5173/voice-lab/ — токен уже подставлен, тема «Тренер интеллектуальных игр».\n");

const stop = () => children.forEach((c) => c.kill("SIGINT"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) c.on("exit", stop);
