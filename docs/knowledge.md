# Knowledge base

What the coach agent may know, kept in [`knowledge/coach/`](../knowledge/coach). The files
are uploaded to the agent behind `COACH_AGENT_ID`. Why a theme needs its own agent for
this: [pipeline](pipeline.md#who-decides-the-role).

The page also bundles them and searches them itself
([`knowledge.ts`](../src/lib/knowledge.ts)): after each thing the person says, the best
`##` sections, up to about 3500 characters, go to the agent as a contextual update under
one context id, so each replaces the last. That needs no access to the agent, at a cost:
the update lands after the server has started replying to those words, so it informs the
turns after them, and the ranking is BM25 over five-letter stems, cruder than the agent's
RAG. Headings that name their subject are what make it work at all.

## Scope

In — what a coach of school and student teams needs to answer from: the rules of ЧГК,
Брейн-ринг, Своя игра, Эрудит-квартет and Даугавпилс; how answers are judged and appealed;
how a season, a session and a warm-up are built; captain, roles, seating and discussion
technique; how a ЧГК question unwinds, by type of move, and how to compose a simple one; how to run a school tournament;
where to find questions and rules.

Out, on purpose:

- **Question packs.** They belong to their authors, are often under moratorium, and an agent
  that recites answers trains nobody. `resources.md` points at the databases instead, and
  `chgk-unwinding.md` keeps what a pack teaches — the moves — without its questions. A
  question to play comes live from gotquestions.online through a tool
  ([pipeline](pipeline.md#training-questions)); `chgk-question-recipes.md` is how the coach
  composes its own when none comes back.
- **The full Codex.** Jury internals, high-level tournament procedure and place-scoring
  schemes serve organisers of championships, not a coach; the relevant chapters are
  summarised with their clause numbers.
- **TV-show history, prizes, celebrity trivia, ratings maths.** Not training.
- **Personal data from the sources** (the season plan has the coach write down each child's
  home phone and birthday) and anything about chess, poker and board games, which the
  prompt excludes.

## Markup

Each document covers one topic, and every `##` heading names its game or its subject
("Брейн-ринг: фальстарт", not "Фальстарт"): RAG returns chunks, not files, and a chunk has
to say what it is about on its own. The second line of each file names its sources, so the agent can say
where an answer comes from.

Everything else lives in `manifest.json`, not in the files, so it never reaches a chunk:
`games`, `topics`, `audience`, `usage_mode`, and `reliability` — `primary` for rule texts,
`methodology` for books by known coaches, `secondary` for club descriptions that vary by
organiser. Each source carries `reuse`: `cc0` may be copied, `paraphrase` may only be
retold. [`manifest.test.js`](../knowledge/manifest.test.js) keeps the two in step.

## Uploading

The agent's Knowledge Base in the ElevenLabs dashboard: add each `.md` except the manifest,
leave the usage mode at **Auto**, enable **Use RAG**. A file under 500 bytes is not indexed
and goes into every prompt instead — the test refuses one. Starting limits for a voice
agent with one-sentence replies, to be tuned against real questions:
`max_documents_length` 8000, `max_retrieved_rag_chunks_count` 6, `max_vector_distance` 0.5.

A changed file has to be uploaded again: the agent keeps the copy it was given.
