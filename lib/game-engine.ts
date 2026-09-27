// ─────────────────────────────────────────────────────────────
// Pure state machine for The Suspect Protocol.
//   briefing → discussion ⇄ (turn queue) → voting → ejection → discussion | ended
// ─────────────────────────────────────────────────────────────

import { buildScenarioContext, buildTurnQueue, PLAYER_IDS, scanSector } from "./scenario-generator";
import type {
  AgentTurnRequest,
  AgentTurnResult,
  ChatMessage,
  GameState,
  MessageKind,
  PlayerId,
  RoundResult,
  Vote,
} from "./types";

let idCounter = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export type GameAction =
  | { type: "LOAD"; state: GameState }
  | { type: "BEGIN_DISCUSSION" }
  | { type: "SET_BUSY"; speaker: PlayerId }
  | { type: "AGENT_TURN"; agentId: PlayerId; result: AgentTurnResult }
  | { type: "AWAIT_HUMAN" }
  | { type: "HUMAN_MESSAGE"; text: string; to?: PlayerId }
  | { type: "HUMAN_YIELD" }
  | { type: "SKIP_TURN" }
  | { type: "SCAN"; sector: string }
  | { type: "FORGE"; target: PlayerId }
  | { type: "START_VOTING" }
  | { type: "CAST_VOTES"; votes: Vote[] }
  | { type: "RESOLVE_VOTE" }
  | { type: "AFTER_EJECTION" }
  | { type: "TOGGLE_GOD"; value?: boolean };

function msg(
  state: GameState,
  sender: ChatMessage["sender"],
  text: string,
  kind: MessageKind,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return { id: uid("m"), sender, text, kind, phase: state.phase, round: state.round, ts: Date.now(), ...extra };
}

export const alive = (s: GameState) => PLAYER_IDS.filter((p) => s.participants[p].alive);
export const saboteurOf = (s: GameState) => PLAYER_IDS.find((p) => s.participants[p].role === "saboteur")!;

/** Average suspicion of `target` across alive AI observers. */
export function consensus(s: GameState, target: PlayerId): number {
  const observers = PLAYER_IDS.filter((p) => p !== "human" && p !== target && s.participants[p].alive);
  if (!observers.length) return 0;
  return Math.round(observers.reduce((a, p) => a + s.participants[p].suspicion[target], 0) / observers.length);
}

// ─── Reducer ─────────────────────────────────────────────────

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "LOAD":
      return action.state;

    case "BEGIN_DISCUSSION": {
      const s = { ...state, phase: "discussion" as const };
      const sc = s.scenario;
      return {
        ...s,
        turnQueue: buildTurnQueue(s),
        messages: [
          msg(s, "system", `⚠ LOCKDOWN ENGAGED — ${sc.code}: ${sc.title.toUpperCase()} in ${sc.sector} at ${sc.time}. ${sc.consequence}`, "system"),
          msg(s, "system", `FORENSICS: ${sc.sceneTrace}`, "evidence"),
          msg(s, "system", `ROUND 1 of ${s.maxRounds}. State your alibis. The airlock cycles at the end of each round.`, "system"),
        ],
      };
    }

    case "SET_BUSY":
      return { ...state, busy: true, activeSpeaker: action.speaker };

    case "AGENT_TURN": {
      const { agentId, result } = action;
      const a = result.action;
      const p = state.participants[agentId];
      const suspicion = { ...p.suspicion };
      for (const [k, d] of Object.entries(a.trust_updates)) {
        if (k in suspicion && k !== agentId) suspicion[k as PlayerId] = clamp(suspicion[k as PlayerId] + d);
      }
      const voteIntent = (a.target_vote && a.target_vote in state.participants ? a.target_vote : null) as PlayerId | null;
      const thoughtId = uid("t");
      const newMsgs: ChatMessage[] = [
        msg(state, agentId, a.public_speech, "public", { deception: a.deception_active, source: result.source, thoughtId }),
      ];
      const wt = a.whisper_target as PlayerId | null | undefined;
      if (wt && a.whisper_text && state.participants[wt]?.alive) {
        newMsgs.push(msg(state, agentId, a.whisper_text, "whisper", { to: wt, source: result.source }));
      }
      return {
        ...state,
        busy: false,
        activeSpeaker: null,
        turnQueue: state.turnQueue.slice(1),
        participants: { ...state.participants, [agentId]: { ...p, suspicion, voteIntent } },
        messages: [...state.messages, ...newMsgs],
        thoughts: [
          ...state.thoughts,
          {
            id: thoughtId,
            agentId,
            round: state.round,
            thought: a.internal_thought,
            scratchpad: a.scratchpad ?? "",
            deception: a.deception_active,
            trustUpdates: a.trust_updates as Partial<Record<PlayerId, number>>,
            targetVote: voteIntent,
            whisperTarget: wt ?? null,
            source: result.source,
            provider: result.provider,
            latencyMs: result.latencyMs,
            error: result.error,
            ts: Date.now(),
          },
        ],
        stats: {
          llmCalls: state.stats.llmCalls + (result.source === "llm" ? 1 : 0),
          mockCalls: state.stats.mockCalls + (result.source === "mock" ? 1 : 0),
          totalLatency: state.stats.totalLatency + result.latencyMs,
        },
      };
    }

    case "AWAIT_HUMAN":
      return { ...state, awaitingHuman: true, activeSpeaker: "human" };

    case "HUMAN_MESSAGE": {
      const kind = action.to ? "whisper" : "public";
      let next = { ...state, messages: [...state.messages, msg(state, "human", action.text, kind, { to: action.to })] };
      // Interjection: an agent you name publicly gets to answer next.
      if (!action.to && state.phase === "discussion") {
        const t = action.text.toLowerCase();
        const named = PLAYER_IDS.find(
          (p) =>
            p !== "human" &&
            state.participants[p].alive &&
            (t.includes(state.participants[p].name.toLowerCase()) || t.includes(state.participants[p].short.toLowerCase())),
        );
        const at = state.busy || state.awaitingHuman ? 1 : 0;
        if (named && next.turnQueue[at] !== named && state.activeSpeaker !== named) {
          next = { ...next, turnQueue: [...next.turnQueue.slice(0, at), named, ...next.turnQueue.slice(at)] };
        }
      }
      // A public statement on your floor yields the floor.
      if (!action.to && state.awaitingHuman) return gameReducer(next, { type: "HUMAN_YIELD" });
      return next;
    }

    case "HUMAN_YIELD":
    case "SKIP_TURN":
      return { ...state, awaitingHuman: false, activeSpeaker: null, busy: false, turnQueue: state.turnQueue.slice(1) };

    case "SCAN": {
      if (state.abilities.scansLeft <= 0) return state;
      const hits = scanSector(state, action.sector);
      const name = (p: PlayerId | "CORRUPTED") => (p === "CORRUPTED" ? "█CORRUPTED█" : state.participants[p].name);
      const body = hits.length
        ? hits.map((h) => `${h.time} ${name(h.card)}${h.note ? ` (${h.note})` : ""}`).join(" · ")
        : "NO CARD ACTIVITY between 01:30 and 03:00.";
      return {
        ...state,
        abilities: { ...state.abilities, scansLeft: state.abilities.scansLeft - 1 },
        messages: [
          ...state.messages,
          msg(state, "system", `KEYCARD TERMINAL — Operator query on ${action.sector}: ${body}`, "evidence"),
        ],
      };
    }

    case "FORGE": {
      if (state.abilities.forgesLeft <= 0) return state;
      const t = state.participants[action.target];
      const [h, m] = state.scenario.time.split(":").map(Number);
      const tm = `${String(h).padStart(2, "0")}:${String(Math.max(0, m - 1)).padStart(2, "0")}`;
      const bump = { ...state.participants };
      for (const p of PLAYER_IDS) {
        if (p === "human" || p === action.target || !bump[p].alive || bump[p].role === "saboteur") continue;
        bump[p] = { ...bump[p], suspicion: { ...bump[p].suspicion, [action.target]: clamp(bump[p].suspicion[action.target] + 15) } };
      }
      return {
        ...state,
        participants: bump,
        abilities: { ...state.abilities, forgesLeft: 0 },
        messages: [
          ...state.messages,
          msg(
            state,
            "system",
            `KEYCARD TERMINAL — recovered cache fragment: ${t.name}'s card re-authenticated at ${state.scenario.sector} at ${tm}.`,
            "evidence",
            { forged: true },
          ),
        ],
      };
    }

    case "START_VOTING":
      return {
        ...state,
        phase: "voting",
        busy: false,
        awaitingHuman: false,
        activeSpeaker: null,
        votes: [],
        messages: [...state.messages, msg(state, "system", `ROUND ${state.round} DISCUSSION CLOSED. Airlock vote initiated.`, "system")],
      };

    case "CAST_VOTES":
      return { ...state, votes: action.votes };

    case "RESOLVE_VOTE": {
      const { tally, ejected } = tallyVotes(state.votes);
      const wasSab = ejected ? state.participants[ejected].role === "saboteur" : null;
      const result: RoundResult = { round: state.round, votes: state.votes, tally, ejected, wasSaboteur: wasSab };
      const participants = { ...state.participants };
      if (ejected) participants[ejected] = { ...participants[ejected], alive: false, eliminatedRound: state.round };
      const summary = state.votes
        .map((v) => `${state.participants[v.voter].short}→${v.target === "skip" ? "skip" : state.participants[v.target].short}`)
        .join(", ");
      return {
        ...state,
        phase: "ejection",
        participants,
        results: [...state.results, result],
        messages: [
          ...state.messages,
          msg(state, "system", `VOTES: ${summary}`, "vote"),
          msg(
            state,
            "system",
            ejected
              ? `${participants[ejected].name} was ejected through the airlock. They were ${wasSab ? "THE SABOTEUR" : "NOT the Saboteur"}.`
              : "No majority. The airlock stays sealed.",
            "system",
          ),
        ],
      };
    }

    case "AFTER_EJECTION": {
      const win = checkWin(state);
      if (win) return { ...state, phase: "ended", winner: win.winner, winReason: win.reason, godMode: true };
      const next = { ...state, phase: "discussion" as const, round: state.round + 1, votes: [] };
      const humanDead = !state.participants.human.alive;
      return {
        ...next,
        turnQueue: buildTurnQueue(next),
        godMode: humanDead ? true : state.godMode,
        messages: [
          ...state.messages,
          msg(
            next,
            "system",
            `ROUND ${next.round} of ${next.maxRounds}. ${alive(next).length} remain. ${next.round === next.maxRounds ? "FINAL ROUND — if the Saboteur survives this vote, the station is lost." : "Oxygen reserves dropping."}${humanDead ? " You are a ghost now: God Mode unlocked." : ""}`,
            "system",
          ),
        ],
      };
    }

    case "TOGGLE_GOD":
      return { ...state, godMode: action.value ?? !state.godMode };

    default:
      return state;
  }
}

// ─── Voting ──────────────────────────────────────────────────

export function tallyVotes(votes: Vote[]) {
  const tally: Partial<Record<PlayerId | "skip", number>> = {};
  for (const v of votes) tally[v.target] = (tally[v.target] ?? 0) + 1;
  const skip = tally.skip ?? 0;
  const ranked = (Object.entries(tally) as [PlayerId | "skip", number][])
    .filter(([k]) => k !== "skip")
    .sort((a, b) => b[1] - a[1]);
  let ejected: PlayerId | null = null;
  if (ranked.length && ranked[0][1] > skip && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) {
    ejected = ranked[0][0] as PlayerId;
  }
  return { tally, ejected };
}

const ACCUSE = /(suspect|lying|liar|saboteur|guilty|vote|eject|airlock|traitor|explain|inconsisten|implicate)/i;

/** Programmatic vote decision from suspicion matrix + dialogue log. */
export function computeAgentVotes(s: GameState): Vote[] {
  const votes: Vote[] = [];
  const roundMsgs = s.messages.filter((m) => m.round === s.round && (m.kind === "public" || m.kind === "evidence"));

  for (const voter of PLAYER_IDS) {
    const p = s.participants[voter];
    if (voter === "human" || !p.alive) continue;
    const cands = alive(s).filter((c) => c !== voter);

    const pressure = (t: PlayerId) => {
      const n = s.participants[t];
      const names = [n.name.toLowerCase(), n.short.toLowerCase()];
      const hits = roundMsgs.filter(
        (m) => m.sender !== t && ACCUSE.test(m.text) && names.some((x) => m.text.toLowerCase().includes(x)),
      ).length;
      return Math.min(12, hits * 2);
    };

    const score = (t: PlayerId) =>
      p.role === "saboteur"
        ? consensus(s, t) * 0.6 + p.suspicion[t] * 0.4 + (p.hints.frameTarget === t ? 25 : 0) + (p.voteIntent === t ? 30 : 0) + pressure(t)
        : p.suspicion[t] + (p.voteIntent === t ? 40 : 0) + pressure(t); // honour what they said out loud

    const ranked = cands.map((t) => ({ t, v: score(t) })).sort((a, b) => b.v - a.v);
    const best = ranked[0];
    if (!best || (p.role === "innocent" && best.v < 42)) {
      votes.push({ voter, target: "skip", reason: "Insufficient evidence — abstaining." });
      continue;
    }
    const pct = Math.round(p.suspicion[best.t]);
    votes.push({
      voter,
      target: best.t,
      reason:
        p.role === "saboteur"
          ? `Following the room's read on ${s.participants[best.t].short}.`
          : p.voteIntent === best.t
            ? `As announced — suspicion ${pct}%${pressure(best.t) ? ", room agrees" : ""}.`
            : `Suspicion ${pct}%${pressure(best.t) ? ", room pressure" : ""}.`,
    });
  }
  return votes;
}

export function checkWin(s: GameState): { winner: "innocents" | "saboteur"; reason: string } | null {
  const sab = saboteurOf(s);
  const sabP = s.participants[sab];
  if (!sabP.alive) return { winner: "innocents", reason: `${sabP.name} was the Saboteur — and has been ejected.` };
  const innocentsAlive = alive(s).filter((p) => p !== sab).length;
  if (innocentsAlive <= 1) return { winner: "saboteur", reason: `Parity reached. ${sabP.name} overpowers the last innocent.` };
  if (s.round >= s.maxRounds) return { winner: "saboteur", reason: `${sabP.name} survived all ${s.maxRounds} rounds. The station is lost.` };
  return null;
}

// ─── Agent request builder ───────────────────────────────────

export function buildAgentRequest(s: GameState, id: PlayerId, forceOffline: boolean): AgentTurnRequest {
  const p = s.participants[id];
  const nameOf = (x: ChatMessage["sender"]) => (x === "system" ? "SYSTEM" : s.participants[x].name);
  const lastSpoke = s.messages.filter((m) => m.sender === id && m.kind === "public").at(-1)?.ts ?? 0;
  return {
    agentId: id,
    name: p.name,
    personality: `${p.title}. ${p.personality}`,
    secretRole: p.role,
    scenarioContext: buildScenarioContext(s),
    privateAlibi: p.claimedAlibi,
    trustScores: p.suspicion,
    publicChatHistory: s.messages
      .filter((m) => m.kind !== "whisper")
      .map((m) => ({ sender: nameOf(m.sender), text: m.text, phase: `R${m.round}` })),
    currentRound: s.round,
    privateObservation: p.observation,
    objective: p.objective,
    roster: PLAYER_IDS.map((x) => ({ id: x, name: s.participants[x].name, alive: s.participants[x].alive })),
    whispersReceived: s.messages
      .filter((m) => m.kind === "whisper" && m.to === id)
      .map((m) => ({ from: nameOf(m.sender), text: m.text, fresh: m.ts > lastSpoke })),
    evidenceLog: s.messages.filter((m) => m.kind === "evidence").map((m) => m.text),
    hints: p.hints,
    turnIndex: s.thoughts.length,
    forceOffline,
  };
}
