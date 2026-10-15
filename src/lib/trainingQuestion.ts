import type { AudienceId } from "./persona";
import type { ClientFunction } from "./pipeline/session";
import type { QuestionSkill, TrainingQuestion, Transport } from "./transport";

const SKILLS: readonly QuestionSkill[] = ["replacement", "homogeneous", "any"];

/** A site question drawn before the conversation, with the skill it was drawn for. */
export interface SessionQuestion {
  skill: QuestionSkill;
  question: TrainingQuestion;
}

/** Long enough for two uncached pack pages; past it the coach starts without a list. */
const SESSION_WAIT_MS = 5000;

/**
 * One question per skill, drawn before the session opens and handed over in the prompt.
 * This works without the client tool, which only someone with the ElevenLabs account can
 * define on the agent. A failed or slow draw costs its question, never the start.
 */
export async function sessionQuestions(
  transport: Transport,
  audience: AudienceId,
  waitMs = SESSION_WAIT_MS,
): Promise<SessionQuestion[]> {
  const draws = SKILLS.map((skill) =>
    transport.trainingQuestion({ skill, audience, exclude: [] }).then(
      (question) => (question ? { skill, question } : null),
      () => null,
    ),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null[]>((resolve) => (timer = setTimeout(() => resolve([]), waitMs)));
  const drawn: (SessionQuestion | null)[] = await Promise.race([Promise.all(draws), late]);
  clearTimeout(timer);

  const seen = new Set<number>();
  return drawn.filter((d): d is SessionQuestion => {
    if (!d || seen.has(d.question.id)) return false;
    seen.add(d.question.id);
    return true;
  });
}

/** Also typed into the agent's client tool in ElevenLabs, which matches it by name: docs/deploy.md. */
export const FIND_TRAINING_QUESTION = {
  name: "find_training_question",
  description:
    "Takes a real ЧГК question from gotquestions.online at the team's level, chosen for the skill being trained. " +
    "Returns its text, answer, accepted answers (zachet), comment and link, or an error when nothing fits.",
  parameters: {
    type: "object",
    properties: {
      skill: {
        type: "string",
        enum: [...SKILLS],
        description:
          "replacement: a word in the question is replaced, and the logic of the swap leads to the answer. " +
          "homogeneous: the answer is one of a kind of things, found by listing them and checking each against the question. " +
          "any: no particular skill.",
      },
    },
    required: ["skill"],
  },
};

/**
 * The tool for one conversation. The audience comes from the page, not from the model, and
 * questions already played are not drawn again. A failure goes back to the model as text:
 * a thrown error would surface as a broken stage instead of a coach composing its own.
 */
export function trainingQuestionFunction(
  transport: Transport,
  audience: AudienceId,
  alreadyPlayed: number[] = [],
): ClientFunction {
  const played = [...alreadyPlayed];
  return {
    ...FIND_TRAINING_QUESTION,
    run: async (args) => {
      const skill = SKILLS.includes(args.skill as QuestionSkill) ? (args.skill as QuestionSkill) : "any";
      try {
        const question = await transport.trainingQuestion({ skill, audience, exclude: [...played] });
        if (!question) {
          return JSON.stringify({ error: "No site question fits this skill and level. Compose one yourself." });
        }
        played.push(question.id);
        return JSON.stringify(question);
      } catch {
        return JSON.stringify({ error: "The question site cannot be reached now. Compose one yourself." });
      }
    },
  };
}
