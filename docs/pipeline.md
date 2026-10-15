# Pipeline

The conversation runs on [ElevenLabs
Agents](https://elevenlabs.io/docs/agents-platform/overview) via
[`@elevenlabs/client`](https://www.npmjs.com/package/@elevenlabs/client) — [SDK
reference](https://elevenlabs.io/docs/agents-platform/libraries/java-script). We do not own the
steps; we own their presentation. [`agentSession.ts`](../src/lib/pipeline/agentSession.ts)
translates SDK events into the stage stream the scene draws.

## Stage mapping

| Stage | Opened by | Closed by |
|---|---|---|
| `capture` | `onModeChange` → `listening` | next mode change |
| `vad` | `onVadScore` crossing 0.5 | score dropping back |
| `stt` | `onAsrInitiationMetadata` | `onMessage` with `source: "user"` |
| `llm` | `onMessage` with `source: "user"` | first `onAudio` |
| `tts` | first `onAudio` | mode leaving `speaking` |
| `playback` | `onModeChange` → `speaking` | next mode change |

`Mode` has only two values — `speaking` and `listening` — so `llm` cannot come from a mode
change and is bracketed between the transcript and the first audio frame. Mode changes drive
one stage at a time; `vad`, `stt`, `llm` and `tts` overlap them and are tracked as lanes. Recognition runs while the agent still listens, and synthesis runs
while it already speaks, so a single "current stage" slot cannot express both.

A lane draws only if the agent is configured to send the event that opens it. `client_events`
lives on the agent, not in this repo and not in anything the client can override, so `vad`
and `stt` go permanently blank when `vad_score` and `asr_initiation_metadata` are missing
from it — with no error anywhere. A dead lane is a question about the agent first and about
this code second.

## Turn boundaries

Returning to `listening` ends a turn: metrics are reported and a fresh turn starts. Stage
durations come from the time between the events, not from anything the SDK reports.

## Ending

`onDisconnect` reports who ended it — `user`, `agent` or `error`. All three must close the
open lanes, or a stage stays open forever behind a dead socket.

## Why not our own pipeline

An earlier version ran capture → VAD → STT → LLM → TTS → playback by hand. Three defects
were structural rather than fixable:

- The microphone heard the agent through the speakers. Browser echo cancellation only
  covers audio from the same context, and playback had its own, so every reply read as
  user speech and cut itself off.
- An energy threshold cannot separate a voice from a barking dog. Silero VAD answers that
  question, but the package is CommonJS and its onnxruntime fetches wasm at runtime, which
  Vite serves with a `?import` suffix it then refuses.
- Chunks arriving after the queue drained were scheduled at "now", leaving audible gaps.

Agents solves all three at the source: input and output share one audio context, the
detector is theirs, playback is theirs.

## Who decides the role

The prompt the agent answers with is not the one configured in the ElevenLabs dashboard:
`src/lib/persona.ts` overrides it in the handshake (`conversation_initiation_client_data`).
Two consequences. It applies **once, at session start** — a running conversation keeps the
role it opened with, so switching roles means a new session. And the agent must permit the
override: with it disallowed the server closes the connection instead of ignoring the
field, which reaches the page as a dropped conversation rather than an error about prompts.

Each theme is a role in `persona.ts`: the prompt, plus — for the coach — the model
(`prompt.llm`), the language and up to 50 ASR keywords. A field the role leaves unset is
not sent, because the model and the language drop the connection like the prompt does when
the agent does not allow them; ASR keywords alone are ignored silently. So the coach's
agent must allow the prompt, LLM and language overrides, and ASR keywords for the hints to
count. With `COACH_AGENT_ID` unset that agent is `AGENT_ID`.

The knowledge base, its RAG limits and the temperature stay on the agent: the SDK has no
typed field for the first and the agent offers no override for the last two. So a theme
with knowledge of its own runs on
an agent of its own: the page sends the theme to `/agent/token`, and the Worker mints for
`COACH_AGENT_ID` when it is set and for `AGENT_ID` otherwise. RAG puts only the chunks
nearest each turn into context, bounded by `max_documents_length`,
`max_retrieved_rag_chunks_count` and `max_vector_distance` on that agent — that, not the
prompt, is what keeps a large corpus out of the context window. Deepgram has no knowledge
base, so there the coach answers without one. What goes into it: [knowledge](knowledge.md).

## Training questions

Before a coach session opens, the page draws one question per skill from `/question` and
puts them into the prompt under `# Questions for this session`; a draw that fails or takes
over five seconds is left out rather than holding up the start. That list needs nothing
on the agent beyond the prompt override, so it works for anyone holding an interview key.

Past the list, the coach plays real questions from gotquestions.online through one function,
`find_training_question` ([`trainingQuestion.ts`](../src/lib/trainingQuestion.ts)), which skips
the questions already in the list. The model
picks the skill — `replacement`, `homogeneous` or `any`; the page adds the audience from its
dropdown and the ids already played, and posts to the Worker's `/question`, which reads a
pack page from its audience's pool and keeps the questions that can be played by voice at
that level ([`worker/questions.js`](../worker/questions.js)). Nothing is stored: the site
is read live, behind a day of edge cache.

On ElevenLabs the function runs as a client tool, matched **by name** to a tool defined on
the agent — the SDK only supplies the handler, so without that tool on the agent the model
never calls it. Deepgram receives the full definition in `Settings`. Either way a failure
returns as text telling the model to compose a question itself, by the recipes in the
knowledge base; a thrown error would surface as a stage error instead. The tool call sits
inside the `llm` lane: the lane stays open until the reply audio starts.

## Backup engine: Deepgram

When ElevenLabs is down, a key can be switched to [Deepgram's Voice Agent
API](https://developers.deepgram.com/docs/voice-agent) in the admin page.
[`deepgramSession.ts`](../src/lib/pipeline/deepgramSession.ts) implements the same
`VoiceSession` as `agentSession.ts`, so the page does not know which one it runs.

What differs, and why the page says so:

- One WebSocket carries everything: `Settings` after `Welcome`, microphone PCM after
  `SettingsApplied`, agent PCM back. There is no SDK; capture and playback are ours
  ([`deepgramAudio.ts`](../src/lib/pipeline/deepgramAudio.ts)), on one `AudioContext` for
  the echo reason above.
- The role, the models and the functions go in `Settings`. Functions run in the page:
  `FunctionCallRequest` → `FunctionCallResponse` with the same `id`, and nothing for a
  call named in `FunctionCallCancelled`.
- `sendText` and `injectAgentMessage` map to `InjectUserMessage` and `InjectAgentMessage`.
- `UserStartedSpeaking` is the barge-in signal: queued agent audio is dropped. A reply ends
  when local playback drains, not at `AgentAudioDone`, which only means the last chunk left
  the server.
- Aura voices are English-only, hence the notice on the page.

| Stage | Opened by | Closed by |
|---|---|---|
| `capture` | `SettingsApplied`, `UserStartedSpeaking`, playback draining | next stage |
| `stt` | `UserStartedSpeaking` | user `ConversationText` |
| `llm` | user `ConversationText` | first agent audio |
| `tts` | first agent audio | `AgentAudioDone` or barge-in |
| `playback` | first agent audio | playback draining or barge-in |

There is no speech-probability event, so `vad` stays blank on this engine.
