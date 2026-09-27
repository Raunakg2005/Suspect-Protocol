// ─────────────────────────────────────────────────────────────
// Provider-agnostic LLM layer (server only).
//   GEMINI_API_KEY → Gemini with native responseSchema enforcement
//   GROQ_API_KEY   → Groq (OpenAI-compatible) with JSON mode
//   neither        → offline deterministic brain
// Every response is re-validated with Zod and sanitized.
// ─────────────────────────────────────────────────────────────

import { z } from "zod";
import type { AgentActionResponse, AgentTurnRequest, ProviderStatus } from "./types";

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 20000);

export function providerStatus(): ProviderStatus {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  const gemini = process.env.GEMINI_API_KEY;
  const groq = process.env.GROQ_API_KEY;
  if (forced === "offline") return { provider: "offline", model: "deterministic-mock" };
  if ((forced === "groq" || !gemini) && groq)
    return { provider: "groq", model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b" };
  if (gemini) return { provider: "gemini", model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash" };
  return { provider: "offline", model: "deterministic-mock" };
}

// Circuit breaker: after a 429/401/403, skip the network for a while so the demo never stalls.
let cooldownUntil = 0;
let cooldownReason = "";
export function inCooldown() {
  return Date.now() < cooldownUntil ? cooldownReason : null;
}

class ProviderError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

// ─── Schema ──────────────────────────────────────────────────

const RawAction = z.object({
  public_speech: z.string().min(1),
  internal_thought: z.string().default(""),
  scratchpad: z.string().nullish(),
  deception_active: z
    .union([z.boolean(), z.string().transform((s) => s.toLowerCase() === "true")])
    .default(false),
  trust_updates: z
    .union([
      z.array(z.object({ target: z.string(), delta: z.coerce.number() })),
      z.record(z.string(), z.coerce.number()),
    ])
    .default([]),
  target_vote: z.string().nullish(),
  whisper_target: z.string().nullish(),
  whisper_text: z.string().nullish(),
});

/** Gemini OpenAPI-subset schema. trust_updates is an array because records can't be expressed. */
const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    public_speech: { type: "STRING", description: "What you say aloud to the room. 1-3 sentences, in character." },
    internal_thought: { type: "STRING", description: "Honest private reasoning. Never shown to other players." },
    scratchpad: { type: "STRING", description: "Terse notes, e.g. 'Mercer 70% · Chen 40% | cleared: Vance'" },
    deception_active: { type: "BOOLEAN", description: "True if public_speech contains a lie or deliberate deflection." },
    trust_updates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          target: { type: "STRING", description: "participant id" },
          delta: { type: "INTEGER", description: "-20..20, positive = more suspicious" },
        },
        required: ["target", "delta"],
      },
    },
    target_vote: { type: "STRING", nullable: true, description: "participant id you'd eject now, or null" },
    whisper_target: { type: "STRING", nullable: true },
    whisper_text: { type: "STRING", nullable: true },
  },
  required: ["public_speech", "internal_thought", "scratchpad", "deception_active", "trust_updates", "target_vote"],
  propertyOrdering: [
    "internal_thought",
    "scratchpad",
    "public_speech",
    "deception_active",
    "trust_updates",
    "target_vote",
    "whisper_target",
    "whisper_text",
  ],
};

// ─── Prompt ──────────────────────────────────────────────────

export function buildPrompt(req: AgentTurnRequest) {
  const isSab = req.secretRole === "saboteur";
  const roster = (req.roster ?? [])
    .map((r) => `  ${r.id} — ${r.name}${r.alive ? "" : " (EJECTED, cannot speak or be voted)"}`)
    .join("\n");
  const frameName = req.roster?.find((r) => r.id === req.hints?.frameTarget)?.name;
  const crimeScene = req.scenarioContext.match(/Location: (.+?)\. Time/)?.[1] ?? "the crime scene";
  const hasSpoken = req.publicChatHistory.some((l) => l.sender === req.name);

  const system = `You are ${req.name}, trapped in a sealed lockdown room aboard a research station during the social-deduction game "The Suspect Protocol".

PERSONALITY: ${req.personality}
Stay fully in character — your voice should be instantly recognizable.

SECRET ROLE: ${isSab ? "SABOTEUR" : "INNOCENT"}
${
  isSab
    ? `You caused the incident. You were really in ${crimeScene} — NEVER say or imply that; you must always claim the cover story below. Lie convincingly, deflect, exploit ambiguous evidence${frameName ? ` (frame ${frameName} — their trace is at the scene too)` : ""}, and quietly recruit allies via whispers. Don't over-defend; sound like a worried innocent. You win if you survive every vote.`
    : "You did NOT cause the incident. Work out who did: share your evidence, test alibis, call out contradictions, avoid getting an innocent ejected. Only cite facts from your private memory, the public evidence, or what was said in chat — never invent sightings or logs."
}

${isSab ? "COVER STORY (claim this publicly, word for word in substance)" : "YOUR ALIBI (true)"}: ${req.privateAlibi}
PRIVATE MEMORY (only you know this): ${req.privateObservation ?? "none"}
OBJECTIVE: ${req.objective ?? (isSab ? "Survive." : "Find the Saboteur.")}

SCENARIO:
${req.scenarioContext}

PARTICIPANTS (use these exact ids in trust_updates / target_vote / whisper_target):
${roster}
"human" is the Operator — a real human player. Treat them as a full suspect, respond when they address you.

OUTPUT: respond with ONLY a JSON object, no prose, with keys:
- internal_thought: 1-3 sentences of your honest private reasoning (the truth — including whether you are lying and why)
- scratchpad: terse suspicion notes
- public_speech: 1-3 sentences (max ~50 words) spoken aloud to the room, in character. Name people. React to the latest messages — especially direct questions — and never repeat yourself.${hasSpoken ? "" : " You have not spoken yet: state your alibi first."}
- deception_active: true if public_speech contains a lie, fabrication, or deliberate deflection
- trust_updates: array of {"target": id, "delta": integer -20..20}; positive = MORE suspicious of them
- target_vote: id you would eject right now, or null
- whisper_target: optional id to secretly message (or null); whisper_text: the secret message (or null). Use whispers sparingly to build alliances.`;

  const suspicion = Object.entries(req.trustScores)
    .filter(([id]) => id !== req.agentId)
    .map(([id, v]) => `${id}: ${Math.round(v)}`)
    .join(", ");
  // Keep the prompt lean: Groq's free tier is ~8k tokens/min per model.
  const history = req.publicChatHistory
    .slice(-14)
    .map((l) => `[${l.phase}] ${l.sender}: ${l.text}`)
    .join("\n");
  const whispers = (req.whispersReceived ?? [])
    .slice(-5)
    .map((w) => `  from ${w.from}: "${w.text}"${w.fresh ? " (NEW — reply privately with whisper_target)" : ""}`)
    .join("\n");
  const evidence = (req.evidenceLog ?? []).map((e) => `  - ${e}`).join("\n");

  const user = `ROUND ${req.currentRound} of 3.
Your current suspicion levels (0-100): ${suspicion}
${evidence ? `Security evidence surfaced so far:\n${evidence}\n` : ""}${whispers ? `Secret whispers you've received:\n${whispers}\n` : ""}
PUBLIC CHANNEL (oldest → newest):
${history || "(silence — you speak first)"}

It is your turn. Output the JSON object now.`;

  return { system, user };
}

// ─── Providers ───────────────────────────────────────────────

async function callGemini(system: string, user: string, model: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: GEMINI_SCHEMA,
          temperature: 0.95,
          maxOutputTokens: 2048,
          // Flash models: skip hidden thinking for snappy turns
          ...(model.includes("2.5-flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    },
  );
  if (!res.ok) throw new ProviderError(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text) throw new ProviderError(`Gemini returned no content (${data?.candidates?.[0]?.finishReason ?? "unknown"})`);
  return text;
}

/** Groq model pool. Rate limits are per model (~8k tokens/min on the free tier), so spreading turns multiplies throughput. */
export function groqModels(): string[] {
  const primary = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
  const extra = (process.env.GROQ_FALLBACK_MODELS ?? "openai/gpt-oss-20b,qwen/qwen3.8-27b")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([primary, ...extra])];
}

/** Approximate tokens reserved per turn (prompt ~2k late-game + max_tokens). */
const TURN_TOKENS = 2800;

const modelRest = new Map<string, { until: number; why: string }>();
const resting = (m: string) => (modelRest.get(m)?.until ?? 0) > Date.now();
const rest = (m: string, ms: number, why: string) => modelRest.set(m, { until: Date.now() + ms, why });

/** "7.66s" | "1m2.5s" | "450ms" → ms */
function parseDuration(v: string | null): number | null {
  if (!v) return null;
  let ms = 0;
  let matched = false;
  for (const [, n, unit] of v.matchAll(/([\d.]+)(ms|m|s|h)/g)) {
    matched = true;
    ms += Number(n) * (unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000);
  }
  if (!matched && !Number.isNaN(Number(v))) return Number(v) * 1000; // bare seconds (retry-after)
  return matched ? ms : null;
}

async function callGroq(system: string, user: string, model: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model,
      temperature: 0.95,
      // Groq reserves prompt + max_tokens against the per-minute budget, so keep this tight
      // (a turn uses ~250-400 output tokens including hidden reasoning).
      max_tokens: 700,
      // gpt-oss: keep hidden reasoning short. (qwen: omitting the param disables reasoning; "low" turns it ON.)
      ...(/gpt-oss/.test(model) ? { reasoning_effort: "low" } : {}),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  // Proactively rest a model until it has room for another turn (budget refills continuously).
  const remaining = Number(res.headers.get("x-ratelimit-remaining-tokens"));
  const limit = Number(res.headers.get("x-ratelimit-limit-tokens")) || 8000;
  const resetTokens = parseDuration(res.headers.get("x-ratelimit-reset-tokens"));
  if (res.ok && Number.isFinite(remaining) && remaining < TURN_TOKENS) {
    rest(model, Math.ceil(((TURN_TOKENS - remaining) / limit) * 60_000), "refilling token budget");
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    if (res.status === 429) {
      const wait = parseDuration(res.headers.get("retry-after")) ?? resetTokens ?? 15_000;
      rest(model, Math.min(wait, 60_000), "rate-limited");
    } else if (res.status === 404 || /model_not_found|decommissioned/.test(body)) {
      rest(model, 3_600_000, "model unavailable");
    } else if (res.status === 400) {
      rest(model, 10_000, "bad JSON output"); // e.g. json_object validation failure — let another model take it
    }
    throw new ProviderError(`Groq ${model} ${res.status}: ${body}`, res.status);
  }
  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (!text) throw new ProviderError(`Groq ${model} returned no content`);
  return text;
}

/** Try each non-resting model, rotated per agent so load spreads. Waits briefly if every model is resting. */
async function groqTurn(req: AgentTurnRequest, system: string, user: string): Promise<{ action: AgentActionResponse; model: string }> {
  const pool = groqModels();
  const offset = [...req.agentId].reduce((a, c) => a + c.charCodeAt(0), 0) % pool.length;
  const order = pool.map((_, i) => pool[(i + offset) % pool.length]);
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const model of order) {
      if (resting(model)) continue;
      try {
        const text = await callGroq(system, user, model);
        return { action: sanitizeAction(extractJson(text), req), model };
      } catch (err) {
        lastErr = err;
        if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) throw err;
        // otherwise (429, bad JSON, timeout) → next model
      }
    }
    // Everything is resting: wait for the soonest model if it's close, then retry once.
    const soonest = Math.min(...order.map((m) => modelRest.get(m)?.until ?? 0)) - Date.now();
    if (attempt === 0 && soonest > 0 && soonest <= 12_000) await new Promise((r) => setTimeout(r, soonest + 150));
    else break;
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError("all Groq models are rate-limited");
}

/** Human-readable pool state for the HUD. */
export function poolStatus(): string | null {
  if (providerStatus().provider !== "groq") return null;
  const pool = groqModels();
  const r = pool.filter(resting);
  if (!r.length) return null;
  return `${r.length}/${pool.length} models resting (${r.map((m) => `${m.split("/").pop()}: ${modelRest.get(m)!.why}`).join(", ")})`;
}

// ─── Parse + sanitize ────────────────────────────────────────

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new ProviderError("No JSON object in model output");
    return JSON.parse(m[0]);
  }
}

export function sanitizeAction(raw: unknown, req: AgentTurnRequest): AgentActionResponse {
  const parsed = RawAction.parse(raw);
  const roster = req.roster ?? Object.keys(req.trustScores).map((id) => ({ id, name: id, alive: true }));

  const resolveId = (v: string | null | undefined, mustBeAlive = true): string | null => {
    if (!v) return null;
    const s = v.trim().toLowerCase();
    if (["null", "none", "skip", "nobody", ""].includes(s)) return null;
    const hit =
      roster.find((r) => r.id.toLowerCase() === s) ??
      roster.find((r) => r.name.toLowerCase() === s) ??
      roster.find((r) => r.name.toLowerCase().includes(s) || s.includes(r.id.toLowerCase()));
    if (!hit || hit.id === req.agentId) return null;
    if (mustBeAlive && !hit.alive) return null;
    return hit.id;
  };

  const updates: Record<string, number> = {};
  const entries = Array.isArray(parsed.trust_updates)
    ? parsed.trust_updates.map((u) => [u.target, u.delta] as const)
    : Object.entries(parsed.trust_updates);
  for (const [t, d] of entries) {
    const id = resolveId(t, false);
    if (id && Number.isFinite(d)) updates[id] = Math.max(-20, Math.min(20, Math.round(d)));
  }

  const whisperTarget = resolveId(parsed.whisper_target);
  const whisperText = parsed.whisper_text?.trim() || null;

  return {
    public_speech: parsed.public_speech.trim().slice(0, 600),
    internal_thought: parsed.internal_thought.trim().slice(0, 800),
    scratchpad: parsed.scratchpad?.trim().slice(0, 200) ?? "",
    deception_active: Boolean(parsed.deception_active),
    trust_updates: updates,
    target_vote: resolveId(parsed.target_vote),
    whisper_target: whisperTarget && whisperText ? whisperTarget : null,
    whisper_text: whisperTarget && whisperText ? whisperText.slice(0, 300) : null,
  };
}

export async function llmAgentTurn(
  req: AgentTurnRequest,
  status: ProviderStatus,
): Promise<{ action: AgentActionResponse; model: string }> {
  const { system, user } = buildPrompt(req);
  try {
    if (status.provider === "gemini") {
      const text = await callGemini(system, user, status.model);
      return { action: sanitizeAction(extractJson(text), req), model: status.model };
    }
    return await groqTurn(req, system, user);
  } catch (err) {
    if (err instanceof ProviderError && err.status) {
      if (err.status === 429 && status.provider === "gemini") {
        cooldownUntil = Date.now() + 30_000;
        cooldownReason = "rate-limited — offline brain for 30s";
      } else if (err.status === 401 || err.status === 403) {
        cooldownUntil = Date.now() + 10 * 60_000;
        cooldownReason = "auth failed — check your API key";
      }
    }
    throw err;
  }
}
