import type { EventBus } from "../events";
import type { Role, ThemeId } from "../persona";
import type { Transport } from "../transport";
import type { TurnMetrics } from "../types";

/** Which managed service runs the conversation. Chosen per key, in the admin page. */
export type Engine = "elevenlabs" | "deepgram";

/** A function the agent may call; it runs here in the page, not on the engine's side. */
export interface ClientFunction {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: Record<string, unknown>;
  /** The result goes back to the model as text. */
  run(args: Record<string, unknown>): string | Promise<string>;
}

/**
 * The role is read at start; a live conversation keeps the one it opened with. Deepgram
 * reads only its prompt: the model, language and recogniser hints are ElevenLabs settings.
 */
export interface SessionDeps extends Role {
  bus: EventBus;
  transport: Transport;
  /** Picks the ElevenLabs agent, and with it the knowledge base. Deepgram has neither. */
  theme: ThemeId;
  /**
   * Run in the page when the model calls them. ElevenLabs matches them by name to client
   * tools defined on the agent; Deepgram is sent their whole definition.
   */
  functions?: ClientFunction[];
  /**
   * Material for what the person just said, or null. ElevenLabs gets it as a contextual
   * update, which lands after the server has started the reply to those words, so it
   * informs the turns after. Deepgram ignores it.
   */
  knowledgeFor?: (words: string) => string | null;
  /** Called when a turn completes, with what each stage cost. */
  onTurn: (metrics: TurnMetrics) => void;
  /**
   * The conversation ended. `reason` says who ended it: the user pressed stop, the agent
   * decided it was done, or the connection failed.
   */
  onEnded: (reason: "user" | "agent" | "error", message?: string) => void;
}

/** What the page drives, whichever engine is underneath. */
export interface VoiceSession {
  readonly isRunning: boolean;
  /** The spectrum of the audio playing right now, or null when nothing is. */
  mouthSpectrum(): Uint8Array | null;
  start(): Promise<void>;
  stop(): Promise<void>;
}
