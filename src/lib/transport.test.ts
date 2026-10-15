import { expect, test, vi } from "vitest";
import { createTransport } from "./transport";

const config = { workerUrl: "https://worker.test", vibeToken: "vibe" };

test("sends the client token and asks the Worker for the theme's session token", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ token: "sess", agentId: "agent_1" }), { status: 200 }),
  );

  const out = await createTransport(config, fetchImpl).agentToken("coach");

  const [url, init] = fetchImpl.mock.calls[0];
  expect(String(url)).toBe("https://worker.test/agent/token");
  expect(init.headers["x-vibe-token"], "the Worker gates on this").toBe("vibe");
  expect(JSON.parse(init.body), "the Worker picks the agent by it").toEqual({ theme: "coach" });
  expect(out).toEqual({ token: "sess", agentId: "agent_1" });
});

test("surfaces a rejected token instead of returning nothing", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));

  await expect(createTransport(config, fetchImpl).agentToken("general")).rejects.toThrow(/401/);
});

test("asks the Worker for a Deepgram grant with the client token", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ token: "dg-jwt" }), { status: 200 }),
  );

  const out = await createTransport(config, fetchImpl).deepgramToken();

  const [url, init] = fetchImpl.mock.calls[0];
  expect(String(url)).toBe("https://worker.test/deepgram-token");
  expect(init.headers["x-vibe-token"]).toBe("vibe");
  expect(out).toEqual({ token: "dg-jwt" });
});

test("asks the Worker for a training question; null is none fitting, a 404 is a missing route", async () => {
  const question = { id: 7, text: "Назовите ИКСА.", answer: "Плот" };
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(question), { status: 200 }));
  const request = { skill: "replacement" as const, audience: "school" as const, exclude: [3] };

  const out = await createTransport(config, fetchImpl).trainingQuestion(request);

  const [url, init] = fetchImpl.mock.calls[0];
  expect(String(url)).toBe("https://worker.test/question");
  expect(init.headers["x-vibe-token"]).toBe("vibe");
  expect(JSON.parse(init.body)).toEqual(request);
  expect(out).toEqual(question);

  const none = vi.fn().mockResolvedValue(new Response("null", { status: 200 }));
  expect(await createTransport(config, none).trainingQuestion(request)).toBeNull();
  for (const status of [404, 502]) {
    const down = vi.fn().mockResolvedValue(new Response("{}", { status }));
    await expect(createTransport(config, down).trainingQuestion(request)).rejects.toThrow(String(status));
  }
});

test("reads the engine, falling back to ElevenLabs on anything it does not know", async () => {
  const answer = (engine: unknown) =>
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ engine }), { status: 200 }));

  expect(await createTransport(config, answer("deepgram")).engine()).toBe("deepgram");
  expect(await createTransport(config, answer("whisper")).engine()).toBe("elevenlabs");
});
