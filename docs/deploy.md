# Deploy

Two independent pieces.

## Frontend — GitHub Pages

[`deploy.yml`](../.github/workflows/deploy.yml) builds and publishes on push to `main`.
`VITE_WORKER_URL` comes from a repository variable: the Worker's address is not a secret,
it is gated by its origin list and by the client token.

`VITE_VIBE_TOKEN` is deliberately absent from the published build — it spends a paid quota.
Live mode is unlocked by pasting the token into the page, where it is kept in IndexedDB
under a non-extractable key (see [`tokenStore.ts`](../src/lib/tokenStore.ts)).

## Worker — Cloudflare

[`worker.yml`](../.github/workflows/worker.yml) runs only on changes under `worker/`, so a
frontend edit never redeploys the service that holds the API keys.

Needs two repository secrets:

- `CLOUDFLARE_API_TOKEN` — scoped to `Workers Scripts: Edit` on one account. No DNS, no
  zones, no billing.
- `CLOUDFLARE_ACCOUNT_ID`

The provider keys (`ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`, `ADMIN_TOKEN`) are bound to the
Worker with `wrangler secret put` and are untouched by a deploy, so they never pass through
CI. `AGENT_ID` is plain `[vars]` — a session token is still required, so it is not a secret.
`COACH_AGENT_ID`, the coach theme's agent with its knowledge base, goes there too. Like
`AGENT_ID` it has to allow the prompt override — and, for the coach, the LLM and language
overrides — and send `vad_score` and
`asr_initiation_metadata` in its client events, or the conversation drops and the lanes go
blank ([pipeline](pipeline.md)).

The coach's agent also needs the client tool the prompt calls, `FIND_TRAINING_QUESTION` in
[`trainingQuestion.ts`](../src/lib/trainingQuestion.ts), with **Wait for response** on. The
name has to match exactly: the SDK finds the handler by it.

`npm run dev:local` does all of this with `ELEVENLABS_API_KEY` from `worker/.dev.vars`:
it creates or updates the tool, uploads changed knowledge files, creates the coach's agent
from `AGENT_ID` when `COACH_AGENT_ID` is unset (and writes the id into `wrangler.toml`),
allows the coach's overrides, then runs the Worker on :8787 and the page against it with
the local key `vibe_dev` filled in. What the agent is set to:
[`scripts/coachAgent.mjs`](../scripts/coachAgent.mjs).

With only an interview key, `VIBE_TOKEN=vibe_...` in `worker/.dev.vars`, the agent is left
alone: the dev server proxies `/voice-lab/worker/question` to the local Worker and
everything else to the deployed one, so the session is minted as on the published page and
the questions arrive in the prompt. No agent RAG and no tool in that mode; the page's own
search of the knowledge base still runs ([knowledge](knowledge.md)).

## Interview keys

Every caller gets a short-lived key, issued from `?admin` and kept in the `KEYS` KV
namespace; there is no permanent one. Setup and the endpoints:
[`worker/README.md`](../worker/README.md).

## Recording fixtures

`?record` adds a control that saves the conversation to a JSON file when it ends — lines
with timings plus the metrics of every turn. It is off unless asked for, so the published
page is unchanged. The files it produces are what an analysis exercise runs on when there
is no live agent to talk to.

## Origins

`ALLOWED_ORIGINS` in [`wrangler.toml`](../worker/wrangler.toml) lists who may call the
Worker; everyone else gets 403. It includes `:5173` for the dev server and `:4173` for
`vite preview`, because checking the production build locally runs on the latter.

## Branch previews

A branch pushed to this repository is published under
`https://unimatch-hiring.github.io/voice-lab/pr-preview/<branch>/`, so a change can be
looked at without merging it. Four live at once; past that the least recently touched are
dropped, because a merged-and-abandoned branch never fires the `delete` event that would
clean it up.

The link finds you rather than the other way round: a comment on the pull request (edited
in place, one per branch), a deployment entry on the branch, and the run's own summary.
Without the deployment GitHub shows a preview nowhere in its interface — it exists, but
only the workflow log knows the address.

Two consequences worth knowing.

The site is a branch (`gh-pages`), not an upload. `main`'s build replaces the root and
leaves `pr-preview/` alone; a preview writes only its own directory. Both take the same
concurrency group, so they cannot push over each other.

A preview needs a write token, so it only covers branches pushed **here**. A fork's
branch builds in CI like any other, but nothing publishes it — handing a write token to
fork code is the hole `pull_request_target` is known for. Someone outside the
organisation gets a preview by being added to it, or not at all.
