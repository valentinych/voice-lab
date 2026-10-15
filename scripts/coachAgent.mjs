/**
 * What the coach's ElevenLabs agent has to be for the page's coach role to work: the
 * overrides the handshake sends allowed, the client tool the prompt calls, the knowledge
 * base behind RAG, and the events the scene draws from. Built from the page's own modules,
 * so the agent cannot drift from what the page sends.
 */
import { COACH_KEYWORDS, coachPrompt, roleFor } from "../src/lib/persona.ts";
import { FIND_TRAINING_QUESTION } from "../src/lib/trainingQuestion.ts";

export const KB_PREFIX = "voice-lab coach";

/** Voices from these models speak English only, and the agent refuses them with language ru. */
const ENGLISH_ONLY_TTS = ["eleven_turbo_v2", "eleven_flash_v2"];

/** The SDK needs the first two; the rest feed the scene's lanes and the training-question tool. */
const CLIENT_EVENTS = [
  "conversation_initiation_metadata",
  "ping",
  "audio",
  "interruption",
  "user_transcript",
  "agent_response",
  "agent_chat_response_part",
  "client_tool_call",
  "vad_score",
  "asr_initiation_metadata",
];

export const CLIENT_TOOL = {
  tool_config: {
    type: "client",
    ...FIND_TRAINING_QUESTION,
    expects_response: true,
    response_timeout_secs: 20,
  },
};

/** Exactly the fields the page overrides for the coach; anything else stays locked. */
export const PLATFORM_SETTINGS = {
  overrides: {
    conversation_config_override: {
      agent: { prompt: { prompt: true, llm: true }, language: true },
      asr: { keywords: true },
    },
  },
};

/** The name a document is uploaded under; the hash makes a changed file a new upload. */
export const kbName = (file, sha) => `${KB_PREFIX} · ${file} · ${sha.slice(0, 8)}`;

/** The coach's conversation config, derived from another agent's so its voice and turn settings carry over. */
export function coachConversationConfig(source, { toolId, knowledgeBase }) {
  const role = roleFor("coach", "school");
  const config = structuredClone(source ?? {});
  const agent = (config.agent ??= {});
  const prompt = (agent.prompt ??= {});
  // GET returns full tool objects under `tools`; sending them next to tool_ids is refused.
  delete prompt.tools;
  Object.assign(prompt, {
    prompt: coachPrompt("school"),
    llm: role.llm,
    temperature: 0.3,
    tool_ids: [...new Set([...(prompt.tool_ids ?? []), toolId])],
    knowledge_base: knowledgeBase,
    rag: {
      ...prompt.rag,
      enabled: true,
      max_documents_length: 8000,
      max_retrieved_rag_chunks_count: 6,
      max_vector_distance: 0.5,
    },
  });
  agent.language = role.language;
  config.asr = { ...config.asr, keywords: COACH_KEYWORDS };
  if (ENGLISH_ONLY_TTS.includes(config.tts?.model_id)) config.tts.model_id = "eleven_flash_v2_5";
  config.conversation = {
    ...config.conversation,
    client_events: [...new Set([...(config.conversation?.client_events ?? []), ...CLIENT_EVENTS])],
  };
  return config;
}
