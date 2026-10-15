import { expect, test, vi } from "vitest";
import { sessionQuestions, trainingQuestionFunction } from "./trainingQuestion";
import type { Transport } from "./transport";

const question = (id: number) => ({
  id,
  text: "Назовите ИКСА.",
  answer: "Плот",
  zachet: null,
  comment: null,
  takePercent: 80,
  url: `https://gotquestions.online/question/${id}`,
});

const transportWith = (trainingQuestion: Transport["trainingQuestion"]) =>
  ({ trainingQuestion: vi.fn(trainingQuestion) }) as unknown as Transport & {
    trainingQuestion: ReturnType<typeof vi.fn>;
  };

test("asks for the page's audience and the model's skill, and hands the question back as text", async () => {
  const transport = transportWith(async () => question(7));
  const tool = trainingQuestionFunction(transport, "students");

  const out = await tool.run({ skill: "homogeneous" });

  expect(transport.trainingQuestion).toHaveBeenCalledWith({ skill: "homogeneous", audience: "students", exclude: [] });
  expect(JSON.parse(out)).toMatchObject({ id: 7, answer: "Плот" });
});

test("does not draw a question already played in this conversation", async () => {
  let next = 7;
  const transport = transportWith(async () => question(next++));
  const tool = trainingQuestionFunction(transport, "school");

  await tool.run({ skill: "any" });
  await tool.run({ skill: "any" });

  expect(transport.trainingQuestion.mock.calls[1][0].exclude).toEqual([7]);
});

test("does not redraw the questions handed over before the conversation", async () => {
  const transport = transportWith(async () => question(9));
  await trainingQuestionFunction(transport, "school", [7, 8]).run({ skill: "any" });

  expect(transport.trainingQuestion.mock.calls[0][0].exclude).toEqual([7, 8]);
});

test("draws one question per skill for the audience before the session, once each", async () => {
  const ids = { replacement: 1, homogeneous: 2, any: 1 } as const;
  const transport = transportWith(async ({ skill }) => question(ids[skill]));

  const drawn = await sessionQuestions(transport, "students");

  expect(transport.trainingQuestion.mock.calls.map((c) => c[0])).toEqual([
    { skill: "replacement", audience: "students", exclude: [] },
    { skill: "homogeneous", audience: "students", exclude: [] },
    { skill: "any", audience: "students", exclude: [] },
  ]);
  expect(drawn.map((d) => [d.skill, d.question.id])).toEqual([
    ["replacement", 1],
    ["homogeneous", 2],
  ]);
});

test("a failed, empty or slow draw costs its question, never the start", async () => {
  const failing = transportWith(async ({ skill }) => {
    if (skill === "replacement") throw new Error("404");
    return skill === "homogeneous" ? null : question(3);
  });
  expect((await sessionQuestions(failing, "school")).map((d) => d.skill)).toEqual(["any"]);

  const stuck = transportWith(() => new Promise(() => {}));
  expect(await sessionQuestions(stuck, "school", 10)).toEqual([]);
});

test("reads a skill it does not know as any", async () => {
  const transport = transportWith(async () => question(7));
  await trainingQuestionFunction(transport, "school").run({ skill: "chess" });

  expect(transport.trainingQuestion.mock.calls[0][0].skill).toBe("any");
});

test("answers an empty draw and a failed one with words for the model, never a throw", async () => {
  const empty = trainingQuestionFunction(transportWith(async () => null), "school");
  const failed = trainingQuestionFunction(
    transportWith(async () => {
      throw new Error("502");
    }),
    "school",
  );

  const emptyError = JSON.parse(await empty.run({ skill: "any" })).error;
  const failedError = JSON.parse(await failed.run({ skill: "any" })).error;
  expect(emptyError).toMatch(/No site question fits[\s\S]*Compose one yourself/);
  expect(failedError, "the model can tell the team the site is down").toMatch(/cannot be reached[\s\S]*Compose one yourself/);
});
