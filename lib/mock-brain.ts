// ─────────────────────────────────────────────────────────────
// Deterministic offline brain. Same inputs → same output.
// Used when no LLM key is configured, the provider rate-limits,
// or the network drops mid-demo.
// ─────────────────────────────────────────────────────────────

import type { AgentActionResponse, AgentTurnRequest, PlayerId } from "./types";
import { AGENT_PROFILES, hashString, mulberry32 } from "./scenario-generator";

type Voice = {
  open: string[];
  accuse: string[];
  defend: string[];
  evidence: string;
  operator: string;
  whisper: string[];
};

const VOICES: Record<string, Voice> = {
  vance: {
    open: [
      "For the record: {alibi} My assay logs are timestamped. {evidence}",
      "Let's be methodical. {alibi} {evidence} Now — everyone else, timestamps please.",
    ],
    accuse: [
      "{t}, your account has a gap I can't reconcile. Explain it, or I'm voting for you.",
      "Probability isn't proof, but {t}'s story is the least consistent in this room.",
      "I've cross-referenced every statement. {t} changes the subject every time the scene trace comes up.",
    ],
    defend: [
      "{a}, accusing me without evidence is exactly what the Saboteur would want. Check my assay logs. Then check {t}.",
      "That's emotional reasoning, {a}. My timeline is verifiable. Is yours? Because {t}'s isn't.",
    ],
    evidence: "My own observations implicate {s}.",
    operator: "Operator, to answer you directly: ",
    whisper: ["Off the record — my data points at {t}. Vote with logic, not volume.", "I don't trust {t}. If you're rational, you'll vote the same way."],
  },
  mercer: {
    open: [
      "Here's mine, straight: {alibi} {evidence}",
      "{alibi} That's it. Now somebody explain why the alarm didn't trip sooner. {evidence}",
    ],
    accuse: [
      "Cut the crap, {t}. Your story stinks and you know it.",
      "I've worked next to {t} for two years. Never seen them this jumpy. My vote's on {t}.",
      "{t}. Airlock. I'm not asking twice.",
    ],
    defend: [
      "Me? You want to point at ME, {a}? I was elbow-deep in coolant lines. Real cute deflection — look at {t}.",
      "Nice try, {a}. The loudest finger-pointer is usually the rat. Right now that's you — or {t}.",
    ],
    evidence: "And I saw something that points right at {s}.",
    operator: "Operator — ",
    whisper: ["Keep it quiet. It's {t}. You and me vote together, we end this.", "Don't let the eggheads talk you in circles. {t}. Trust me."],
  },
  unit734: {
    open: [
      "Statement: {alibi} Diagnostic logs are immutable. {evidence}",
      "Initiating disclosure protocol. {alibi} {evidence}",
    ],
    accuse: [
      "Analysis complete. Probability that {t} is the Saboteur: {p} percent. Recommending ejection.",
      "{t}, your statements contain {n} inconsistencies. Protocol 12 requires that I flag this.",
      "Behavioral variance detected in {t}. Elevated deflection frequency. Suspicion vector updated.",
    ],
    defend: [
      "Accusation logged, {a}. This unit cannot falsify timestamps. Your accusation raises your own probability by 11 percent.",
      "Correction, {a}: this unit lacks the motive you describe. Redirecting analysis to {t}.",
    ],
    evidence: "Sensor memory implicates {s}.",
    operator: "Query acknowledged, Operator. ",
    whisper: ["Private channel. Coalition proposal: we vote {t}. Success probability 71 percent.", "Sharing restricted analysis: {t} is the highest-risk designation."],
  },
  chen: {
    open: [
      "Please, everyone, let's stay calm. {alibi} {evidence}",
      "I think we all want the same thing here. {alibi} {evidence}",
    ],
    accuse: [
      "I don't want to point fingers… but has anyone noticed {t} hasn't really answered the question?",
      "Perhaps {t} could walk us through their timeline once more? Just so we're all comfortable.",
      "I'd suggest — gently — that {t} is the one whose story nobody has confirmed.",
    ],
    defend: [
      "{a}, I understand the fear, truly. But aren't we better off looking at the evidence than at each other? At {t}, for instance?",
      "I'm happy to answer anything, {a}. Though I do wonder why you're so eager to end this quickly.",
    ],
    evidence: "I… did notice something that concerns me about {s}.",
    operator: "That's a fair question, Operator. ",
    whisper: ["Just between us — I'm worried about {t}. Could we align our votes?", "I'd rather not say this publicly, but {t} frightens me. You'll keep this quiet?"],
  },
};

const ACCUSATORY =
  /(suspect|lying|liar|lie|saboteur|guilty|vote|eject|airlock|sus|traitor|explain|where were you|doesn'?t add up|don'?t trust|inconsisten|story stinks|implicate|probability)/i;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function fill(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "").replace(/\s+/g, " ").trim();
}

export function mockAgentTurn(req: AgentTurnRequest): AgentActionResponse {
  const me = req.agentId as PlayerId;
  const rng = mulberry32(
    hashString(`${req.agentId}|${req.currentRound}|${req.publicChatHistory.length}|${req.turnIndex ?? 0}`),
  );
  const pick = <T,>(a: T[]) => a[Math.floor(rng() * a.length)];
  const voice = VOICES[me] ?? VOICES.vance;
  const isSab = req.secretRole === "saboteur";

  const roster =
    req.roster ?? Object.keys(req.trustScores).map((id) => ({ id, name: id, alive: true }));
  const others = roster.filter((r) => r.alive && r.id !== me);
  const shortOf = (id: string) =>
    id === "human"
      ? roster.find((r) => r.id === "human")?.name ?? "the Operator"
      : AGENT_PROFILES[id as keyof typeof AGENT_PROFILES]?.short ?? id;
  const idBySender = (sender: string) =>
    roster.find((r) => r.name === sender || r.id === sender)?.id;
  const mentions = (text: string) =>
    roster
      .filter((r) => {
        const t = text.toLowerCase();
        const s = shortOf(r.id).toLowerCase();
        return t.includes(r.name.toLowerCase()) || (s.length > 2 && t.includes(s));
      })
      .map((r) => r.id);

  const deltas: Record<string, number> = {};
  const bump = (id: string, d: number) => {
    if (id === me || !others.some((o) => o.id === id)) return;
    deltas[id] = clamp((deltas[id] ?? 0) + d, -20, 20);
  };

  const myName = roster.find((r) => r.id === me)?.name ?? req.name;
  const history = req.publicChatHistory;
  const spokenBefore = history.some((l) => l.sender === myName);
  const recent = history.slice(-8);
  const accusers = new Set<string>();

  // React to the room
  for (const line of recent) {
    const sid = idBySender(line.sender);
    if (!sid || sid === me) continue;
    // Only sentences that both accuse and name someone count as an accusation against them
    const accused = line.text
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => ACCUSATORY.test(sentence))
      .flatMap((sentence) => mentions(sentence));
    for (const m of new Set(accused)) {
      if (m === me) {
        accusers.add(sid);
        bump(sid, isSab ? 9 : 6);
      } else if (!isSab) {
        bump(m, 3);
      }
    }
  }

  // Private evidence
  if (!isSab && !spokenBefore) {
    for (const s of req.hints?.suspects ?? []) bump(s, 10);
    for (const c of req.hints?.cleared ?? []) bump(c, -12);
  }
  // Who claimed which sector? ("I was in <sector>, ...")
  const claims = new Map<string, string>();
  for (const line of history) {
    const sid = idBySender(line.sender);
    const m = line.text.match(/I was in ([^,.]+)[,.]/i);
    if (sid && m) claims.set(sid, m[1].trim().toLowerCase());
  }
  for (const ev of req.evidenceLog ?? []) {
    if (isSab) continue;
    for (const m of mentions(ev)) bump(m, 2);
    // Keycard scan of an empty sector contradicts anyone who claimed to be there
    const empty = ev.match(/query on (.+?): NO CARD ACTIVITY/i);
    if (empty) {
      const sector = empty[1].trim().toLowerCase();
      for (const [sid, claimed] of claims) if (claimed === sector) bump(sid, 14);
    }
  }
  // Whispers colour judgement slightly
  for (const w of req.whispersReceived ?? []) {
    const from = idBySender(w.from);
    for (const m of mentions(w.text)) if (m !== me && m !== from) bump(m, 2);
  }

  const projected = (id: string) => clamp((req.trustScores[id] ?? 20) + (deltas[id] ?? 0), 0, 100);

  // Choose target
  let target: string;
  const frame = req.hints?.frameTarget;
  const latestAccuser = [...accusers].pop();
  if (isSab) {
    const accuser = latestAccuser;
    target =
      frame && others.some((o) => o.id === frame)
        ? frame
        : accuser ?? [...others].sort((a, b) => projected(b.id) - projected(a.id))[0]?.id ?? "skip";
    bump(target, 8);
  } else {
    target = [...others].sort((a, b) => projected(b.id) - projected(a.id))[0]?.id ?? "skip";
  }

  const tShort = shortOf(target);
  const evidenceSubject =
    !isSab && (req.hints?.suspects ?? []).find((s) => others.some((o) => o.id === s));
  const cleared = (req.hints?.cleared ?? []).find((c) => others.some((o) => o.id === c));
  let evidence = "";
  if (isSab) evidence = frame && others.some((o) => o.id === frame) ? `Also — ${shortOf(frame)}'s trace is at the scene. Let's not pretend we didn't all read that.` : "";
  else if (evidenceSubject) evidence = fill(voice.evidence, { s: shortOf(evidenceSubject) });
  else if (cleared) evidence = `For what it's worth, ${shortOf(cleared)} is clear — I can confirm where they were.`;

  const vars = {
    alibi: req.privateAlibi,
    t: tShort,
    a: latestAccuser ? (latestAccuser === "human" ? "Operator" : shortOf(latestAccuser)) : tShort,
    evidence,
    p: String(clamp(Math.round(projected(target) + rng() * 12), 38, 97)),
    n: String(2 + Math.floor(rng() * 3)),
  };

  // Did the Operator just address me?
  const lastHuman = [...recent].reverse().find((l) => idBySender(l.sender) === "human");
  const humanAddressedMe = !!lastHuman && (mentions(lastHuman.text).includes(me) || lastHuman.text.includes("?"));

  let intent: "open" | "defend" | "accuse";
  if (!spokenBefore) intent = "open";
  else if (accusers.size) intent = "defend";
  else intent = "accuse";

  // Never repeat a line this agent already said
  const said = new Set(history.filter((l) => l.sender === myName).map((l) => l.text));
  const options = voice[intent].map((t) => fill(t, vars));
  const fresh = options.filter((o) => ![...said].some((s) => s.endsWith(o)));
  let speech = pick(fresh.length ? fresh : options);
  if (humanAddressedMe && spokenBefore && latestAccuser !== "human" && lastHuman === recent[recent.length - 1]) speech = voice.operator + speech;

  // Deception ground truth
  const chenDeflects = me === "chen" && !isSab && intent !== "open" && rng() < 0.25;
  const deception = isSab ? intent !== "accuse" || rng() < 0.85 : chenDeflects;

  // Internal monologue
  const score = projected(target);
  const sorted = [...others].sort((a, b) => projected(b.id) - projected(a.id));
  const accuserTxt = accusers.size
    ? ` ${[...accusers].map(shortOf).join(" & ")} ${accusers.size > 1 ? "are" : "is"} pushing on me.`
    : "";
  const thought = isSab
    ? `Cover story holding${accusers.size ? " — barely" : ""}.${accuserTxt} ${frame ? `${shortOf(frame)} is my shield: their trace sits right next to mine at the scene.` : ""} Steering the room toward ${tShort}. ${sorted.find((o) => o.id !== target) ? `${shortOf(sorted.find((o) => o.id !== target)!.id)} is the one who could unravel this.` : ""}`
    : `Highest suspicion: ${tShort} at ${score}%.${accuserTxt}${accusers.size ? " Either they're scared or deflecting — noted." : ""} ${evidenceSubject ? `My own evidence points at ${shortOf(evidenceSubject)}.` : "No hard evidence yet — reading behavior."}${chenDeflects ? " I'm keeping my real read vague so I don't become the next target." : ""} Watch who defends ${tShort}.`;

  const scratchpad = sorted
    .slice(0, 3)
    .map((o) => `${shortOf(o.id)} ${projected(o.id)}%`)
    .join(" · ") + (cleared ? ` | cleared: ${shortOf(cleared)}` : "");

  // Whisper
  let whisper_target: string | null = null;
  let whisper_text: string | null = null;
  const whisperChance = me === "chen" ? 0.45 : isSab ? 0.4 : 0.25;
  if (spokenBefore && rng() < whisperChance) {
    const humanAlive = others.some((o) => o.id === "human");
    const ally =
      isSab && humanAlive && rng() < 0.6
        ? "human"
        : [...others].filter((o) => o.id !== target).sort((a, b) => projected(a.id) - projected(b.id))[0]?.id;
    if (ally) {
      whisper_target = ally;
      whisper_text = fill(pick(voice.whisper), { t: tShort });
    }
  }

  // Always answer a fresh private message from the Operator
  const operatorName = roster.find((r) => r.id === "human")?.name;
  const freshFromOperator = (req.whispersReceived ?? []).filter((w) => w.fresh && w.from === operatorName).at(-1);
  if (freshFromOperator && others.some((o) => o.id === "human")) {
    whisper_target = "human";
    whisper_text = `Got your message. ${fill(pick(voice.whisper), { t: tShort })}`;
  }

  return {
    public_speech: speech,
    internal_thought: thought.replace(/\s+/g, " ").trim(),
    deception_active: deception,
    trust_updates: deltas,
    target_vote: isSab || score >= 45 ? target : null,
    whisper_target,
    whisper_text,
    scratchpad,
  };
}
