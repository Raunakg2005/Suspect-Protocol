// ─────────────────────────────────────────────────────────────
// The Suspect Protocol — shared type definitions
// ─────────────────────────────────────────────────────────────

export type PlayerId = "human" | "vance" | "mercer" | "unit734" | "chen";
export type AgentId = Exclude<PlayerId, "human">;
export type SecretRole = "saboteur" | "innocent";

export type GamePhase =
  | "boot" // terminal boot + callsign
  | "briefing" // private role dossier
  | "discussion" // rounds 1..3, sequential turns
  | "voting" // vote modal
  | "ejection" // airlock cinematic
  | "ended"; // debrief

export type Accent = "cyan" | "emerald" | "violet" | "amber" | "sky";

export interface AgentProfile {
  id: PlayerId;
  name: string;
  short: string;
  title: string;
  personality: string;
  /** Physical trace this person leaves behind. The core deduction mechanic. */
  tell: string;
  accent: Accent;
  voice: { pitch: number; rate: number };
}

export interface Participant extends AgentProfile {
  isHuman: boolean;
  role: SecretRole;
  alive: boolean;
  eliminatedRound: number | null;
  /** What this participant will publicly claim. For the saboteur it's a lie. */
  claimedAlibi: string;
  /** Where they actually were during the incident. */
  trueLocation: string;
  /** Private eyewitness memory (true for innocents, self-knowledge for saboteur). */
  observation: string;
  objective: string;
  /** This participant's suspicion (0-100) of every other participant. */
  suspicion: Record<PlayerId, number>;
  /** Most recent vote intention emitted by the model. */
  voteIntent: PlayerId | null;
  /** Structured hints the offline brain uses in lieu of reading prose. */
  hints: DeductionHints;
}

export interface DeductionHints {
  /** People this participant's evidence points toward. */
  suspects: PlayerId[];
  /** People this participant can vouch for. */
  cleared: PlayerId[];
  /** Saboteur only: preferred scapegoat. */
  frameTarget?: PlayerId;
}

export interface AccessLogEntry {
  time: string;
  sector: string;
  card: PlayerId | "CORRUPTED";
  note?: string;
}

export interface Scenario {
  seed: number;
  code: string; // e.g. "INC-4471"
  title: string; // "Cryo-Coolant Valve Severed"
  sector: string; // "Sector B — Cryo Vault"
  time: string; // "02:14"
  method: string;
  consequence: string;
  sectors: string[];
  sceneTrace: string; // forensic trace found at the scene (ambiguous: two tells)
  accessLog: AccessLogEntry[];
  headline: string; // one-liner for banners
}

export type MessageKind = "public" | "whisper" | "system" | "evidence" | "vote";

export interface ChatMessage {
  id: string;
  sender: PlayerId | "system";
  text: string;
  kind: MessageKind;
  phase: GamePhase;
  round: number;
  to?: PlayerId;
  /** Ground truth: was this a lie / deflection? Only revealed in God Mode. */
  deception?: boolean;
  source?: BrainSource;
  forged?: boolean;
  thoughtId?: string;
  ts: number;
}

export type BrainSource = "llm" | "mock";

export interface ThoughtEntry {
  id: string;
  agentId: PlayerId;
  round: number;
  thought: string;
  scratchpad: string;
  deception: boolean;
  trustUpdates: Partial<Record<PlayerId, number>>;
  targetVote: PlayerId | null;
  whisperTarget: PlayerId | null;
  source: BrainSource;
  provider: string;
  latencyMs: number;
  error?: string;
  ts: number;
}

export interface Vote {
  voter: PlayerId;
  target: PlayerId | "skip";
  reason: string;
}

export interface RoundResult {
  round: number;
  votes: Vote[];
  tally: Partial<Record<PlayerId | "skip", number>>;
  ejected: PlayerId | null;
  wasSaboteur: boolean | null;
}

export type Winner = "innocents" | "saboteur";

export interface GameState {
  phase: GamePhase;
  round: number; // 1..3
  maxRounds: number;
  scenario: Scenario;
  participants: Record<PlayerId, Participant>;
  order: PlayerId[];
  messages: ChatMessage[];
  thoughts: ThoughtEntry[];
  turnQueue: PlayerId[];
  activeSpeaker: PlayerId | null;
  awaitingHuman: boolean;
  busy: boolean;
  votes: Vote[];
  results: RoundResult[];
  winner: Winner | null;
  winReason: string;
  godMode: boolean;
  abilities: { scansLeft: number; forgesLeft: number };
  stats: { llmCalls: number; mockCalls: number; totalLatency: number };
}

// ─── API contract ────────────────────────────────────────────

export interface PublicLine {
  sender: string;
  text: string;
  phase: string;
}

export interface AgentTurnRequest {
  agentId: string;
  name: string;
  personality: string;
  secretRole: SecretRole;
  scenarioContext: string;
  privateAlibi: string;
  trustScores: Record<string, number>;
  publicChatHistory: PublicLine[];
  currentRound: number;
  // extended context (optional so the spec's minimal payload still works)
  privateObservation?: string;
  objective?: string;
  roster?: Array<{ id: string; name: string; alive: boolean }>;
  whispersReceived?: Array<{ from: string; text: string; fresh?: boolean }>;
  evidenceLog?: string[];
  hints?: DeductionHints;
  turnIndex?: number;
  forceOffline?: boolean;
}

/**
 * Structured action returned by every agent turn.
 * trust_updates are SUSPICION deltas: positive = more suspicious, range -20..+20.
 */
export interface AgentActionResponse {
  public_speech: string;
  internal_thought: string;
  deception_active: boolean;
  trust_updates: Record<string, number>;
  target_vote: string | null;
  whisper_target?: string | null;
  whisper_text?: string | null;
  scratchpad?: string;
}

export interface AgentTurnResult {
  action: AgentActionResponse;
  source: BrainSource;
  provider: string;
  latencyMs: number;
  error?: string;
}

export interface ProviderStatus {
  provider: "gemini" | "groq" | "offline";
  model: string;
}
