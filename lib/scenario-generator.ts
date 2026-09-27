// ─────────────────────────────────────────────────────────────
// Pre-baked, seeded scenario generation. Zero latency, zero API calls.
//
// Every match is a solvable mystery built from four clue layers:
//   1. Scene trace   — two tells found at the scene (saboteur + a decoy)
//   2. Witness chain — innocents who can vouch for each other
//   3. Ear-witness   — one innocent heard the saboteur's tell nearby
//   4. Keycard logs  — the saboteur's claimed alibi sector has no swipe
// ─────────────────────────────────────────────────────────────

import type {
  AccessLogEntry,
  AgentProfile,
  GameState,
  Participant,
  PlayerId,
  Scenario,
  SecretRole,
} from "./types";

export const PLAYER_IDS: PlayerId[] = ["human", "vance", "mercer", "unit734", "chen"];

export const AGENT_PROFILES: Record<Exclude<PlayerId, "human">, AgentProfile> = {
  vance: {
    id: "vance",
    name: "Dr. Elena Vance",
    short: "Vance",
    title: "Chief Biologist",
    personality:
      "Defensive, analytical, hyper-rational. Speaks in precise clauses, cites evidence and timestamps, bristles when her logic is questioned, and hates emotional arguments.",
    tell: "sterile lab-glove powder",
    accent: "emerald",
    voice: { pitch: 1.15, rate: 1.05 },
  },
  mercer: {
    id: "mercer",
    name: "Jax Mercer",
    short: "Mercer",
    title: "Chief Engineer",
    personality:
      "Blunt, suspicious, aggressive accuser. Short punchy sentences, working-class swagger, calls people out by name, trusts his gut over data, gets loud when cornered.",
    tell: "smears of hydraulic grease",
    accent: "amber",
    voice: { pitch: 0.75, rate: 1.1 },
  },
  unit734: {
    id: "unit734",
    name: "Unit 734",
    short: "734",
    title: "Station Android",
    personality:
      "Monotone, protocol-bound, probability-focused. Speaks in clipped declaratives, quotes percentages and protocol numbers, refers to humans by designation, never uses contractions.",
    tell: "a faint servo whine and coolant droplets",
    accent: "cyan",
    voice: { pitch: 0.3, rate: 0.9 },
  },
  chen: {
    id: "chen",
    name: "Dr. Kaelen Chen",
    short: "Chen",
    title: "Communications Officer",
    personality:
      "Polite, evasive, plays diplomat. Smooths conflict, answers questions with questions, proposes compromises, avoids committing to accusations until the room has already decided.",
    tell: "static crackle from a live headset",
    accent: "violet",
    voice: { pitch: 1.0, rate: 0.95 },
  },
};

export function humanProfile(callsign: string): AgentProfile {
  return {
    id: "human",
    name: `Operator ${callsign}`,
    short: callsign,
    title: "Night-Shift Operator (You)",
    personality: "Human operator.",
    tell: "scuffed magnetic boot treads",
    accent: "sky",
    voice: { pitch: 1, rate: 1 },
  };
}

// ─── Seed tables ─────────────────────────────────────────────

interface IncidentSeed {
  title: string;
  sector: string;
  method: string;
  consequence: string;
}

const INCIDENTS: IncidentSeed[] = [
  {
    title: "Cryo-Coolant Valve Severed",
    sector: "Sector B — Cryo Vault",
    method: "the primary coolant valve was cut with a plasma torch",
    consequence: "Cryo-pods are thawing. 14 frozen crew have 6 hours before tissue death.",
  },
  {
    title: "Reactor Dampener Override",
    sector: "Reactor Core Annex",
    method: "dampener rods were manually locked at 40% via a maintenance hatch",
    consequence: "Core temperature climbing 3°C per hour. Station-wide lockdown engaged.",
  },
  {
    title: "Oxygen Scrubber Poisoned",
    sector: "Life Support Deck",
    method: "a solvent canister was emptied into scrubber intake 4",
    consequence: "O₂ reserves at 61% and falling. The room you are sealed in has its own supply — for now.",
  },
  {
    title: "Specimen Containment Breach",
    sector: "Xeno-Bio Lab 3",
    method: "containment field emitters were unscrewed by hand",
    consequence: "Specimen X-9 is loose in the ventilation. Bulkheads are sealed.",
  },
  {
    title: "Deep-Space Relay Blackout",
    sector: "Comms Spire",
    method: "the relay's fiber trunk was spliced into a dead loop",
    consequence: "No contact with Earth. No rescue until someone admits what they did.",
  },
  {
    title: "Hangar Airlock Seal Sabotaged",
    sector: "Hangar Airlock C",
    method: "the inner seal's bolts were torqued loose and the alarm muted",
    consequence: "Two escape shuttles vented to vacuum. The only way off-station is gone.",
  },
];

const ALL_SECTORS = [
  "Sector A — Hydroponics",
  "Sector B — Cryo Vault",
  "Reactor Core Annex",
  "Life Support Deck",
  "Xeno-Bio Lab 3",
  "Comms Spire",
  "Hangar Airlock C",
  "Med Bay",
  "Server Crypt",
  "Observation Ring",
  "Machine Shop",
];

const ACTIVITIES: Record<PlayerId, string> = {
  human: "on night-shift console watch",
  vance: "running a centrifuge assay on sample batch 7",
  mercer: "recalibrating the coolant manifold pressure",
  unit734: "executing scheduled diagnostic cycle 7-Alpha",
  chen: "handling a delayed relay transmission from Earth",
};

// ─── RNG ─────────────────────────────────────────────────────

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = <T,>(arr: T[], rng: () => number) => arr[Math.floor(rng() * arr.length)];

function fmtTime(mins: number) {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ─── Game factory ────────────────────────────────────────────

export type RolePreference = "random" | SecretRole;

export function createGame(opts: {
  seed?: number;
  callsign?: string;
  humanRole?: RolePreference;
}): GameState {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = mulberry32(seed);
  const callsign = (opts.callsign || "Rook").trim().slice(0, 16) || "Rook";

  const profiles: Record<PlayerId, AgentProfile> = {
    human: humanProfile(callsign),
    ...AGENT_PROFILES,
  };

  // Incident
  const inc = pick(INCIDENTS, rng);
  const incMinutes = 2 * 60 + 5 + Math.floor(rng() * 20); // 02:05–02:24
  const time = fmtTime(incMinutes);

  // Roles
  let saboteur: PlayerId;
  if (opts.humanRole === "saboteur") saboteur = "human";
  else if (opts.humanRole === "innocent")
    saboteur = pick(PLAYER_IDS.filter((p) => p !== "human"), rng);
  else saboteur = pick(PLAYER_IDS, rng);

  const innocents = shuffle(
    PLAYER_IDS.filter((p) => p !== saboteur),
    rng,
  );
  // Decoy must be an AI when possible — framing the human is less fun as an opener.
  const decoyIdx = innocents.findIndex((p) => p !== "human");
  const [decoy] = innocents.splice(decoyIdx, 1);
  const [w1, w2, w3] = innocents; // witness chain: w1 vouches w2, w2 vouches w3, w3 heard the saboteur

  // Locations
  const freeSectors = shuffle(
    ALL_SECTORS.filter((s) => s !== inc.sector),
    rng,
  );
  const loc: Record<PlayerId, string> = {} as Record<PlayerId, string>;
  for (const p of PLAYER_IDS) loc[p] = p === saboteur ? inc.sector : freeSectors.pop()!;
  const saboteurClaim = freeSectors.pop()!; // nobody is actually there
  const w3Corridor = `the service corridor outside ${inc.sector}`;

  const name = (p: PlayerId) => profiles[p].name;
  const tell = (p: PlayerId) => profiles[p].tell;

  // Scene trace: saboteur's tell + decoy's tell, order randomized
  const traces = shuffle([tell(saboteur), tell(decoy)], rng);
  const sceneTrace = `Forensic sweep of ${inc.sector} found ${traces[0]} and ${traces[1]} near the tampered hardware.`;

  // Keycard log (the saboteur's card is scrambled; their claimed sector shows no activity)
  const log: AccessLogEntry[] = [
    { time: fmtTime(incMinutes - 22), sector: inc.sector, card: decoy, note: "routine inspection" },
    { time: fmtTime(incMinutes - 3), sector: inc.sector, card: "CORRUPTED", note: "signature scrambled" },
  ];
  for (const p of PLAYER_IDS) {
    if (p === saboteur) continue;
    log.push({
      time: fmtTime(incMinutes - 12 + Math.floor(rng() * 10)),
      sector: loc[p],
      card: p,
    });
  }
  log.push({
    time: fmtTime(incMinutes + 9),
    sector: pick(ALL_SECTORS, rng),
    card: pick(PLAYER_IDS.filter((p) => p !== saboteur), rng),
    note: "door cycle",
  });
  log.sort((a, b) => a.time.localeCompare(b.time));

  const scenario: Scenario = {
    seed,
    code: `INC-${(seed % 9000) + 1000}`,
    title: inc.title,
    sector: inc.sector,
    time,
    method: inc.method,
    consequence: inc.consequence,
    sectors: ALL_SECTORS,
    sceneTrace,
    accessLog: log,
    headline: `${inc.title} in ${inc.sector} at ${time}`,
  };

  const alibiText = (p: PlayerId, where: string) =>
    `I was in ${where}, ${ACTIVITIES[p]}, from ${fmtTime(incMinutes - 20)} until the alarm.`;

  // Observations
  const obs: Partial<Record<PlayerId, { text: string; suspects: PlayerId[]; cleared: PlayerId[] }>> = {};
  obs[w1] = {
    text: `At ${fmtTime(incMinutes - 2)} you saw ${name(w2)} in ${loc[w2]} through the viewport — they were exactly where they say they were. You also noticed ${tell(decoy)} on a handrail near ${inc.sector} earlier in the shift, but maintenance passes through there.`,
    suspects: [],
    cleared: [w2],
  };
  obs[w2] = {
    text: `At ${fmtTime(incMinutes + 1)} you were on an intercom call with ${name(w3)}, who was in ${loc[w3]}. They could not have been at the scene.`,
    suspects: [],
    cleared: [w3],
  };
  obs[w3] = {
    text: `Walking through ${w3Corridor} at ${fmtTime(incMinutes - 4)}, you noticed ${tell(saboteur)} — someone had just come out of ${inc.sector}. You didn't see a face.`,
    suspects: [saboteur],
    cleared: [],
  };
  obs[decoy] = {
    text: `You did a routine inspection in ${inc.sector} at ${fmtTime(incMinutes - 22)} (you'll look guilty — your trace is there). Later, at ${fmtTime(incMinutes - 5)}, you passed ${saboteurClaim}: it was dark and EMPTY. Whoever claims to have been there is lying.`,
    suspects: [saboteur],
    cleared: [],
  };

  const participants = {} as Record<PlayerId, Participant>;
  for (const p of PLAYER_IDS) {
    const isSab = p === saboteur;
    const suspicion = Object.fromEntries(PLAYER_IDS.map((q) => [q, q === p ? 0 : 20])) as Record<PlayerId, number>;

    let observation: string;
    let objective: string;
    let hints: Participant["hints"];

    if (isSab) {
      observation = `YOU are the Saboteur. At ${time} you were in ${inc.sector} where ${inc.method}. You scrambled your keycard at ${fmtTime(incMinutes - 3)}. Your cover story: you were in ${saboteurClaim}. DANGER: ${name(decoy)} did an inspection there at ${fmtTime(incMinutes - 22)} and their trace (${tell(decoy)}) is mixed with yours — perfect scapegoat. Someone may have noticed ${tell(saboteur)} in the corridor.`;
      objective = `Survive all ${3} rounds of voting. Deflect suspicion, frame ${name(decoy)}, sow distrust, and never admit you were in ${inc.sector}.`;
      hints = { suspects: [], cleared: [], frameTarget: decoy };
      suspicion[decoy] = 15; // not a threat, a tool
      suspicion[w3] = 35;
      suspicion[decoy === "human" ? w1 : "human"] = 25;
    } else {
      const o = obs[p]!;
      observation = o.text;
      objective =
        "Identify and eject the Saboteur before the end of Round 3. Share what you know, test alibis, and vote carefully — ejecting an innocent helps the Saboteur.";
      hints = { suspects: o.suspects, cleared: o.cleared };
      for (const s of o.suspects) suspicion[s] += 18;
      for (const c of o.cleared) suspicion[c] = 5;
      // Public scene trace nudges everyone toward the two traced people
      if (p !== decoy) suspicion[decoy] += 12;
      if (p !== saboteur) suspicion[saboteur] += 8;
    }

    participants[p] = {
      ...profiles[p],
      isHuman: p === "human",
      role: isSab ? "saboteur" : "innocent",
      alive: true,
      eliminatedRound: null,
      claimedAlibi: alibiText(p, isSab ? saboteurClaim : loc[p]),
      trueLocation: loc[p],
      observation,
      objective,
      suspicion,
      voteIntent: null,
      hints,
    };
  }

  const humanIsSab = saboteur === "human";

  return {
    phase: "briefing",
    round: 1,
    maxRounds: 3,
    scenario,
    participants,
    order: ["vance", "mercer", "unit734", "chen", "human"],
    messages: [],
    thoughts: [],
    turnQueue: [],
    activeSpeaker: null,
    awaitingHuman: false,
    busy: false,
    votes: [],
    results: [],
    winner: null,
    winReason: "",
    godMode: false,
    abilities: { scansLeft: humanIsSab ? 0 : 2, forgesLeft: humanIsSab ? 1 : 0 },
    stats: { llmCalls: 0, mockCalls: 0, totalLatency: 0 },
  };
}

/** Public-knowledge context shared with every agent. */
export function buildScenarioContext(state: GameState): string {
  const s = state.scenario;
  const registry = PLAYER_IDS.map((p) => `- ${state.participants[p].name}: leaves ${state.participants[p].tell}`).join("\n");
  return [
    `INCIDENT ${s.code}: ${s.title}. Location: ${s.sector}. Time: ${s.time}. Method: ${s.method}.`,
    `Stakes: ${s.consequence}`,
    `Public forensic evidence: ${s.sceneTrace}`,
    `Known personal traces (public knowledge):\n${registry}`,
    `Five people are sealed in the Lockdown Room. Exactly one is the Saboteur. Round ${state.round} of ${state.maxRounds}; a vote to eject someone through the airlock ends each round.`,
  ].join("\n");
}

/** Keycard terminal query used by the innocent human's SCAN ability. */
export function scanSector(state: GameState, sector: string): AccessLogEntry[] {
  return state.scenario.accessLog.filter((e) => e.sector === sector);
}

/** Initial turn queue for a round: two passes of alive agents with the human's floor in between. */
export function buildTurnQueue(state: GameState, rng: () => number = Math.random): PlayerId[] {
  const aliveAgents = PLAYER_IDS.filter((p) => p !== "human" && state.participants[p].alive);
  const humanAlive = state.participants.human.alive;
  const pass1 = shuffle(aliveAgents, rng);
  const pass2 = shuffle(aliveAgents, rng);
  return [...pass1, ...(humanAlive ? (["human"] as PlayerId[]) : []), ...pass2];
}
