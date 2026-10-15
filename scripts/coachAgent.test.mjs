// @vitest-environment node
import { describe, expect, it } from "vitest";
import { COACH_KEYWORDS, coachPrompt } from "../src/lib/persona.ts";
import { FIND_TRAINING_QUESTION } from "../src/lib/trainingQuestion.ts";
import { CLIENT_TOOL, coachConversationConfig, kbName, PLATFORM_SETTINGS } from "./coachAgent.mjs";

const source = {
  agent: {
    language: "en",
    first_message: "Привет",
    prompt: { prompt: "general", llm: "gpt-4o-mini", tool_ids: ["tool_end_call"], tools: [{ name: "end_call" }] },
  },
  tts: { model_id: "eleven_flash_v2", voice_id: "voice_1" },
  conversation: { client_events: ["audio", "user_transcript"] },
};
const kb = [{ type: "file", id: "doc_1", name: "voice-lab coach · rules.md · abcdef12", usage_mode: "auto" }];
const coach = () => coachConversationConfig(source, { toolId: "tool_q", knowledgeBase: kb });

describe("the coach agent's config", () => {
  it("carries the page's coach prompt, model, language and recogniser hints", () => {
    const c = coach();
    expect(c.agent.prompt).toMatchObject({ prompt: coachPrompt("school"), llm: "claude-sonnet-5-5" });
    expect(c.agent.language).toBe("ru");
    expect(c.asr.keywords).toBe(COACH_KEYWORDS);
  });

  it("adds the training-question tool next to the agent's own, and drops the tool objects GET returns", () => {
    const c = coach();
    expect(c.agent.prompt.tool_ids).toEqual(["tool_end_call", "tool_q"]);
    expect(c.agent.prompt).not.toHaveProperty("tools");
    expect(coachConversationConfig(c, { toolId: "tool_q", knowledgeBase: kb }).agent.prompt.tool_ids).toEqual([
      "tool_end_call",
      "tool_q",
    ]);
  });

  it("attaches the knowledge base behind RAG with the starting limits", () => {
    const { knowledge_base, rag } = coach().agent.prompt;
    expect(knowledge_base).toBe(kb);
    expect(rag).toMatchObject({ enabled: true, max_documents_length: 8000, max_retrieved_rag_chunks_count: 6 });
  });

  it("moves an English-only voice model to a multilingual one, and keeps the voice", () => {
    expect(coach().tts).toEqual({ model_id: "eleven_flash_v2_5", voice_id: "voice_1" });
    const multilingual = { ...source, tts: { model_id: "eleven_v4_turbo" } };
    expect(coachConversationConfig(multilingual, { toolId: "t", knowledgeBase: [] }).tts.model_id).toBe("eleven_v4_turbo");
  });

  it("sends the events the SDK, the lanes and the client tool depend on", () => {
    const events = coach().conversation.client_events;
    for (const e of ["conversation_initiation_metadata", "client_tool_call", "vad_score", "asr_initiation_metadata"]) {
      expect(events).toContain(e);
    }
  });

  it("leaves the source agent untouched", () => {
    coach();
    expect(source.agent.prompt.prompt).toBe("general");
  });
});

describe("what goes to ElevenLabs alongside the config", () => {
  it("allows exactly the overrides the page sends", () => {
    expect(PLATFORM_SETTINGS.overrides.conversation_config_override).toEqual({
      agent: { prompt: { prompt: true, llm: true }, language: true },
      asr: { keywords: true },
    });
  });

  it("defines the client tool from the page's definition, waiting for its answer", () => {
    expect(CLIENT_TOOL.tool_config).toMatchObject({
      type: "client",
      name: FIND_TRAINING_QUESTION.name,
      parameters: FIND_TRAINING_QUESTION.parameters,
      expects_response: true,
    });
  });

  it("names a changed document differently, so it is uploaded again", () => {
    expect(kbName("rules.md", "aaaaaaaa11")).not.toBe(kbName("rules.md", "bbbbbbbb11"));
  });
});
