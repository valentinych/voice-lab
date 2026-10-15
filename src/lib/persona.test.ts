import { expect, test } from "vitest";
import { coachPrompt, GENERAL_PROMPT, roleFor } from "./persona";

const COACH_PROMPT = coachPrompt("school");

test("the general prompt follows whatever the person brings up and is not the quiz coach", () => {
  expect(GENERAL_PROMPT).toContain("voice assistant of voice-lab");
  expect(GENERAL_PROMPT).toContain("whatever the person brings up");
  expect(GENERAL_PROMPT).not.toContain("Что?Где?Когда?");
  expect(GENERAL_PROMPT).not.toContain("ЧГК");
  expect(GENERAL_PROMPT).not.toContain("Своя игра");
  expect(GENERAL_PROMPT).not.toContain("Брейн-ринг");
  expect(GENERAL_PROMPT).not.toContain("Даугавпилсы");
});

test("the coach prompt organizes quiz training and does not interview", () => {
  expect(COACH_PROMPT).toContain("organizing the training process");
  expect(COACH_PROMPT).toContain("children and students");
  expect(COACH_PROMPT).toContain("Что?Где?Когда?");
  expect(COACH_PROMPT).toContain("ЧГК");
  expect(COACH_PROMPT).toContain("Своя игра");
  expect(COACH_PROMPT).toContain("Брейн-ринг");
  expect(COACH_PROMPT).toContain("Даугавпилсы");
  // Named as excluded. Listing them as examples would still contain the words.
  expect(COACH_PROMPT).toMatch(/out of scope[\s\S]{0,120}chess, checkers, poker, bridge/);
  expect(COACH_PROMPT).not.toContain("such as chess");
  // A softer "prefer this subject" still answers the diversion.
  expect(COACH_PROMPT).toContain("do not answer");
  expect(COACH_PROMPT).not.toContain("whatever the person brings up");
  expect(COACH_PROMPT).not.toMatch(/\bask\b/i);
  expect(COACH_PROMPT).toMatch(/do not end a reply with a question/i);
});

test("the coach does not state facts about the games it is not certain of, and says so", () => {
  expect(COACH_PROMPT).toMatch(/do not state facts about the games[\s\S]{0,120}not certain of/i);
  expect(COACH_PROMPT).toMatch(/do not have\s+that information instead of guessing/);
});

const section = (prompt: string, heading: string) =>
  prompt.split(/^# /m).find((s) => s.startsWith(`${heading}\n`)) ?? "";

test("the coach's scope and its facts rule sit under # Guardrails, the heading models weigh most", () => {
  const guardrails = section(COACH_PROMPT, "Guardrails");
  expect(guardrails).toMatch(/out of scope[\s\S]{0,120}chess, checkers, poker, bridge/);
  expect(guardrails).toContain("do not answer it");
  expect(guardrails).toMatch(/do not state facts about the games/i);
});

test("the quiz drill called «Покер» is not refused along with the card game", () => {
  expect(section(COACH_PROMPT, "Guardrails")).toMatch(/«Покер»[^\n]*in scope/);
});

test("the coach is told who it trains, and only that audience", () => {
  const school = section(coachPrompt("school"), "Audience");
  const students = section(coachPrompt("students"), "Audience");
  expect(school).toContain("school teams");
  expect(school).not.toContain("student teams");
  expect(students).toContain("student teams");
  expect(students).not.toContain("school teams");
});

test("the coach's example replies lead with help and never end on a question", () => {
  const replies = section(COACH_PROMPT, "Examples")
    .split("\n")
    .filter((l) => l.startsWith("Ответ:"));
  expect(replies.length).toBeGreaterThanOrEqual(3);
  for (const reply of replies) expect(reply.trim().endsWith("?"), reply).toBe(false);
});

test("the coach speaks Russian on a stronger model, and the general role overrides neither", () => {
  expect(section(COACH_PROMPT, "Tone")).toContain("Speak Russian");
  expect(COACH_PROMPT).not.toContain("Speak the language the person speaks");

  const coach = roleFor("coach", "school");
  expect(coach).toMatchObject({ llm: "claude-sonnet-5-5", language: "ru" });

  // An agent that does not allow these overrides drops the call, so the general role sends none.
  expect(roleFor("general", "school")).toEqual({ prompt: GENERAL_PROMPT });
});
