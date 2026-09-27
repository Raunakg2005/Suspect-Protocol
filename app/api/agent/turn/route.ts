import { z } from "zod";
import { groqModels, inCooldown, llmAgentTurn, poolStatus, providerStatus } from "@/lib/llm";
import { mockAgentTurn } from "@/lib/mock-brain";
import type { AgentTurnRequest, AgentTurnResult } from "@/lib/types";

export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1),
  personality: z.string(),
  secretRole: z.enum(["saboteur", "innocent"]),
  scenarioContext: z.string(),
  privateAlibi: z.string(),
  trustScores: z.record(z.string(), z.number()),
  publicChatHistory: z.array(z.object({ sender: z.string(), text: z.string(), phase: z.string() })),
  currentRound: z.number().int().min(1),
  privateObservation: z.string().optional(),
  objective: z.string().optional(),
  roster: z.array(z.object({ id: z.string(), name: z.string(), alive: z.boolean() })).optional(),
  whispersReceived: z.array(z.object({ from: z.string(), text: z.string(), fresh: z.boolean().optional() })).optional(),
  evidenceLog: z.array(z.string()).optional(),
  hints: z
    .object({
      suspects: z.array(z.string()),
      cleared: z.array(z.string()),
      frameTarget: z.string().optional(),
    })
    .optional(),
  turnIndex: z.number().optional(),
  forceOffline: z.boolean().optional(),
});

/** Provider status for the HUD. */
export async function GET() {
  const status = providerStatus();
  return Response.json({
    ...status,
    pool: status.provider === "groq" ? groqModels() : undefined,
    cooldown: inCooldown() ?? poolStatus(),
  });
}

export async function POST(request: Request) {
  const started = Date.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const req = parsed.data as AgentTurnRequest;
  const status = providerStatus();
  const cooldown = inCooldown();

  const offline = (error?: string): AgentTurnResult => ({
    action: mockAgentTurn(req),
    source: "mock",
    provider: "offline-brain",
    latencyMs: Date.now() - started,
    error,
  });

  if (req.forceOffline || status.provider === "offline") return Response.json(offline());
  if (cooldown) return Response.json(offline(cooldown));

  try {
    const { action, model } = await llmAgentTurn(req, status);
    const result: AgentTurnResult = {
      action,
      source: "llm",
      provider: `${status.provider}:${model}`,
      latencyMs: Date.now() - started,
    };
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[agent/turn] ${req.agentId} fell back to offline brain: ${msg}`);
    return Response.json(offline(msg.slice(0, 160)));
  }
}
