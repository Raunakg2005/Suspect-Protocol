"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  ChevronDown,
  Cpu,
  Eye,
  EyeOff,
  Lock,
  Network,
  Radar,
  ShieldCheck,
  Skull,
  WifiOff,
  Zap,
} from "lucide-react";
import type { GameState, PlayerId, ProviderStatus, ThoughtEntry } from "@/lib/types";
import { consensus } from "@/lib/game-engine";
import { PLAYER_IDS } from "@/lib/scenario-generator";
import { ACCENT, heat, initials, scramble } from "@/lib/ui";

type Tab = "radar" | "minds" | "web";

export interface CognitiveHudProps {
  state: GameState;
  onToggleGod: () => void;
  provider: (ProviderStatus & { cooldown?: string | null }) | null;
  offline: boolean;
  onToggleOffline: () => void;
  godLocked?: boolean;
}

export default function CognitiveHud({ state, onToggleGod, provider, offline, onToggleOffline, godLocked }: CognitiveHudProps) {
  const [tab, setTab] = useState<Tab>("radar");
  const god = state.godMode;
  const { llmCalls, mockCalls, totalLatency } = state.stats;
  const calls = llmCalls + mockCalls;
  const lastThought = state.thoughts[state.thoughts.length - 1];

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-zinc-800 bg-slate-950/80">
      {/* Header */}
      <div className="border-b border-zinc-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-cyan-400" />
            <h2 className="text-[11px] font-bold tracking-[0.25em] text-cyan-300">COGNITIVE TELEMETRY</h2>
          </div>
          <GodSwitch on={god} onClick={onToggleGod} locked={godLocked} />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1.5 text-[10px]">
          <Stat label="LLM" value={llmCalls} tone="text-cyan-300" />
          <Stat label="OFFLINE" value={mockCalls} tone="text-amber-300" />
          <Stat label="AVG ms" value={calls ? Math.round(totalLatency / calls) : 0} tone="text-slate-300" />
        </div>

        <button
          onClick={onToggleOffline}
          className="mt-2 flex w-full items-center justify-between rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-[10px] transition hover:border-zinc-600"
          title="Force the deterministic offline brain (no API calls)"
        >
          <span className="flex items-center gap-1.5 text-slate-400">
            {offline || provider?.provider === "offline" ? (
              <WifiOff className="h-3 w-3 text-amber-400" />
            ) : (
              <Zap className="h-3 w-3 text-emerald-400" />
            )}
            NEURAL LINK
          </span>
          <span className={offline || provider?.provider === "offline" ? "text-amber-300" : "text-emerald-300"}>
            {offline
              ? "OFFLINE (forced)"
              : provider
                ? provider.provider === "offline"
                  ? "OFFLINE (no key)"
                  : `${provider.provider}:${provider.model}`
                : "…"}
          </span>
        </button>
        {provider?.cooldown && !offline && (
          <p className="mt-1 text-[10px] text-amber-400">⚠ {provider.cooldown}</p>
        )}
        {lastThought?.error && !offline && (
          <p className="mt-1 truncate text-[10px] text-amber-500/80" title={lastThought.error}>
            ↳ fallback: {lastThought.error}
          </p>
        )}

        <div className="mt-3 flex gap-1 rounded bg-zinc-900/70 p-0.5">
          {(
            [
              ["radar", Radar, "Radar"],
              ["minds", BrainCircuit, "Minds"],
              ["web", Network, "Trust Web"],
            ] as const
          ).map(([k, Icon, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[10px] tracking-wider transition ${
                tab === k ? "bg-cyan-500/15 text-cyan-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon className="h-3 w-3" />
              {label.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "radar" && (
          <>
            <SuspicionRadar state={state} />
            <SuspicionBars state={state} />
            <DeceptionDetector state={state} />
          </>
        )}
        {tab === "minds" && <MonologueStream state={state} />}
        {tab === "web" && <TrustWeb state={state} />}
      </div>
    </aside>
  );
}

// ─── Pieces ──────────────────────────────────────────────────

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1">
      <div className="text-[9px] tracking-widest text-slate-500">{label}</div>
      <div className={`font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function GodSwitch({ on, onClick, locked }: { on: boolean; onClick: () => void; locked?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={locked}
      className={`group flex items-center gap-2 rounded-full border px-2 py-1 text-[10px] font-bold tracking-widest transition ${
        on
          ? "border-red-500/60 bg-red-500/15 text-red-300 shadow-[0_0_18px_rgba(239,68,68,0.35)]"
          : "border-zinc-700 bg-zinc-900 text-slate-400 hover:border-zinc-500"
      } ${locked ? "cursor-not-allowed opacity-80" : ""}`}
      title="Spectator God Mode: reveal roles, private memories, hidden thoughts and lies"
    >
      {on ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      GOD MODE
      <span className={`relative h-3.5 w-6 rounded-full transition ${on ? "bg-red-500/70" : "bg-zinc-700"}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${on ? "left-3" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Activity; children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-4 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.2em] text-slate-500 first:mt-0">
      <Icon className="h-3 w-3" /> {children}
    </h3>
  );
}

/** Polar radar: the closer to the core, the more the room suspects you. */
function SuspicionRadar({ state }: { state: GameState }) {
  const size = 220;
  const c = size / 2;
  const god = state.godMode;
  return (
    <div>
      <SectionTitle icon={Radar}>LIVE SUSPICION RADAR</SectionTitle>
      <div className="relative mx-auto aspect-square w-full max-w-[240px]">
        <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
          <defs>
            <radialGradient id="core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(239,68,68,0.35)" />
              <stop offset="35%" stopColor="rgba(239,68,68,0.05)" />
              <stop offset="100%" stopColor="rgba(34,211,238,0.02)" />
            </radialGradient>
            <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(34,211,238,0)" />
              <stop offset="100%" stopColor="rgba(34,211,238,0.35)" />
            </linearGradient>
          </defs>
          <circle cx={c} cy={c} r={c - 4} fill="url(#core)" stroke="rgba(34,211,238,0.25)" />
          {[0.25, 0.5, 0.75].map((f) => (
            <circle key={f} cx={c} cy={c} r={(c - 4) * f} fill="none" stroke="rgba(34,211,238,0.12)" strokeDasharray="2 3" />
          ))}
          <line x1={c} y1={4} x2={c} y2={size - 4} stroke="rgba(34,211,238,0.08)" />
          <line x1={4} y1={c} x2={size - 4} y2={c} stroke="rgba(34,211,238,0.08)" />
          <g className="radar-sweep">
            <path d={`M ${c} ${c} L ${c} 4 A ${c - 4} ${c - 4} 0 0 1 ${c + (c - 4) * Math.sin(Math.PI / 5)} ${c - (c - 4) * Math.cos(Math.PI / 5)} Z`} fill="url(#sweep)" />
          </g>
          <text x={c} y={c + 3} textAnchor="middle" fontSize="7" fill="rgba(239,68,68,0.7)" letterSpacing="2">
            THREAT
          </text>
          {PLAYER_IDS.map((p, i) => {
            const part = state.participants[p];
            const s = consensus(state, p);
            const ang = (i / PLAYER_IDS.length) * Math.PI * 2 - Math.PI / 2;
            const r = 16 + (1 - s / 100) * (c - 26);
            const x = c + Math.cos(ang) * r;
            const y = c + Math.sin(ang) * r;
            const h = heat(s);
            const isSab = god && part.role === "saboteur";
            return (
              <g key={p} style={{ transition: "all 1s ease" }}>
                {part.alive ? (
                  <>
                    <circle cx={x} cy={y} r={3} fill={h.hex} className="blip-ping" />
                    <circle cx={x} cy={y} r={isSab ? 6 : 4.5} fill={h.hex} stroke={isSab ? "#fff" : "none"} strokeWidth={1.2} />
                  </>
                ) : (
                  <text x={x} y={y + 3} textAnchor="middle" fontSize="9" fill="#52525b">✕</text>
                )}
                <text x={x} y={y - 8} textAnchor="middle" fontSize="7.5" fill={part.alive ? ACCENT[part.accent].hex : "#52525b"}>
                  {part.short.toUpperCase()}
                  {isSab ? " ☠" : ""}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function SuspicionBars({ state }: { state: GameState }) {
  const rows = PLAYER_IDS.map((p) => ({ p, v: consensus(state, p) })).sort((a, b) => b.v - a.v);
  return (
    <div>
      <SectionTitle icon={Activity}>ROOM CONSENSUS · SUSPICION</SectionTitle>
      <div className="space-y-1.5">
        {rows.map(({ p, v }) => {
          const part = state.participants[p];
          const h = heat(v);
          return (
            <div key={p} className={part.alive ? "" : "opacity-40"}>
              <div className="flex items-center justify-between text-[10px]">
                <span className={`${ACCENT[part.accent].text} flex items-center gap-1`}>
                  {!part.alive && <Skull className="h-3 w-3" />}
                  {part.short}
                  {state.godMode && part.role === "saboteur" && <span className="rounded bg-red-500/20 px-1 text-[8px] text-red-300">SAB</span>}
                </span>
                <span className={`tabular-nums ${h.text}`}>{v}%</span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div className={`h-full rounded-full ${h.bar} transition-all duration-1000 ease-out`} style={{ width: `${v}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeceptionDetector({ state }: { state: GameState }) {
  const god = state.godMode;
  const agents = PLAYER_IDS.filter((p) => p !== "human");
  return (
    <div>
      <SectionTitle icon={AlertTriangle}>DECEPTION DETECTOR</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5">
        {agents.map((p) => {
          const part = state.participants[p];
          const mine = state.thoughts.filter((t) => t.agentId === p);
          const last = mine[mine.length - 1];
          const lies = mine.filter((t) => t.deception).length;
          const bluff = !!last?.deception;
          return (
            <div
              key={p}
              className={`rounded border px-2 py-1.5 text-[10px] transition ${
                !god
                  ? "border-zinc-800 bg-zinc-900/50"
                  : bluff
                    ? "border-red-500/60 bg-red-500/10 shadow-[0_0_12px_rgba(239,68,68,0.25)]"
                    : "border-emerald-600/40 bg-emerald-500/5"
              } ${part.alive ? "" : "opacity-40"}`}
            >
              <div className={`font-bold ${ACCENT[part.accent].text}`}>{part.short}</div>
              {!god ? (
                <div className="mt-0.5 flex items-center gap-1 text-slate-500">
                  <Lock className="h-2.5 w-2.5" /> ENCRYPTED
                </div>
              ) : !last ? (
                <div className="mt-0.5 text-slate-500">NO SIGNAL</div>
              ) : bluff ? (
                <div className="glow-pulse mt-0.5 font-bold text-red-400">⚠ BLUFFING</div>
              ) : (
                <div className="mt-0.5 text-emerald-400">✓ TRUTHFUL</div>
              )}
              {god && <div className="mt-0.5 text-[9px] text-slate-500">{lies} lie{lies === 1 ? "" : "s"} logged</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Scramble → plaintext decrypt animation. Remount (via key) to replay. */
function DecryptText({ text, on, seed }: { text: string; on: boolean; seed: number }) {
  const steps = 14;
  const [frame, setFrame] = useState(on ? 0 : steps);
  useEffect(() => {
    if (!on) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setFrame(i);
      if (i >= steps) clearInterval(id);
    }, 35);
    return () => clearInterval(id);
  }, [on]);
  if (!on) return <>{scramble(text, seed)}</>;
  const cut = Math.floor((Math.min(frame, steps) / steps) * text.length);
  return <>{text.slice(0, cut) + scramble(text.slice(cut), seed + frame)}</>;
}

function MonologueStream({ state }: { state: GameState }) {
  const god = state.godMode;
  const list = useMemo(() => [...state.thoughts].reverse(), [state.thoughts]);
  if (!list.length)
    return <p className="mt-8 text-center text-[11px] text-slate-600">Awaiting first neural packet…</p>;
  return (
    <div className="space-y-2">
      <SectionTitle icon={BrainCircuit}>INTERNAL MONOLOGUE STREAM</SectionTitle>
      {!god && (
        <p className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-[10px] text-slate-500">
          <Lock className="mr-1 inline h-3 w-3" />
          Thought packets are encrypted. Enable <span className="text-red-300">GOD MODE</span> to decrypt.
        </p>
      )}
      {list.map((t, i) => (
        <ThoughtCard key={t.id} t={t} state={state} defaultOpen={i < 3} />
      ))}
    </div>
  );
}

function ThoughtCard({ t, state, defaultOpen }: { t: ThoughtEntry; state: GameState; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const god = state.godMode;
  const p = state.participants[t.agentId];
  const a = ACCENT[p.accent];
  const seed = t.ts % 997;
  return (
    <div
      className={`msg-in rounded border ${god && t.deception ? "border-red-500/50" : "border-zinc-800"} bg-zinc-900/50 text-[11px]`}
    >
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left">
        <span className={`flex h-5 w-5 items-center justify-center rounded ${a.bg} ${a.text} border ${a.border} text-[9px] font-bold`}>
          {initials(p.name)}
        </span>
        <span className={`font-bold ${a.text}`}>{p.short}</span>
        <span className="text-[9px] text-slate-600">R{t.round}</span>
        <span
          className={`ml-auto rounded px-1 text-[8px] tracking-wider ${
            t.source === "llm" ? "bg-cyan-500/15 text-cyan-300" : "bg-amber-500/15 text-amber-300"
          }`}
          title={t.provider}
        >
          {t.source === "llm" ? "LLM" : "OFFLINE"} · {t.latencyMs}ms
        </span>
        {god && t.deception && <span className="rounded bg-red-500/20 px-1 text-[8px] font-bold text-red-300">LIE</span>}
        <ChevronDown className={`h-3 w-3 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-zinc-800 px-2 py-1.5">
          <p className={`leading-relaxed ${god ? "text-slate-200" : "select-none text-slate-600"}`}>
            <DecryptText key={`th-${god}`} text={t.thought || "(no thought emitted)"} on={god} seed={seed} />
          </p>
          {t.scratchpad && (
            <p className="rounded bg-zinc-950/70 px-1.5 py-1 text-[10px] text-slate-400">
              <Cpu className="mr-1 inline h-2.5 w-2.5" />
              <DecryptText key={`sp-${god}`} text={t.scratchpad} on={god} seed={seed + 7} />
            </p>
          )}
          {god && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(t.trustUpdates).map(([k, d]) =>
                d ? (
                  <span
                    key={k}
                    className={`rounded px-1 text-[9px] ${d > 0 ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}
                  >
                    {state.participants[k as PlayerId]?.short} {d > 0 ? "+" : ""}
                    {d}
                  </span>
                ) : null,
              )}
              {t.targetVote && (
                <span className="rounded bg-zinc-800 px-1 text-[9px] text-amber-300">
                  vote → {state.participants[t.targetVote].short}
                </span>
              )}
              {t.whisperTarget && (
                <span className="rounded bg-violet-500/15 px-1 text-[9px] text-violet-300">
                  whispered → {state.participants[t.whisperTarget].short}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Directed suspicion graph + full matrix. */
function TrustWeb({ state }: { state: GameState }) {
  const god = state.godMode;
  const size = 240;
  const c = size / 2;
  const R = 88;
  const pos = Object.fromEntries(
    PLAYER_IDS.map((p, i) => {
      const ang = (i / PLAYER_IDS.length) * Math.PI * 2 - Math.PI / 2;
      return [p, { x: c + Math.cos(ang) * R, y: c + Math.sin(ang) * R }];
    }),
  ) as Record<PlayerId, { x: number; y: number }>;
  const observers = PLAYER_IDS.filter((p) => p !== "human");

  return (
    <div>
      <SectionTitle icon={Network}>SUSPICION VECTORS</SectionTitle>
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[260px]">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>
        {observers.map((o) =>
          PLAYER_IDS.filter((t) => t !== o).map((t) => {
            const op = state.participants[o];
            if (!op.alive || !state.participants[t].alive) return null;
            const v = op.suspicion[t];
            if (v < 35) return null;
            const a = pos[o];
            const b = pos[t];
            // offset curve so A→B and B→A don't overlap
            const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12;
            const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
            const h = heat(v);
            return (
              <path
                key={`${o}-${t}`}
                d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
                fill="none"
                stroke={h.hex}
                strokeOpacity={0.25 + (v / 100) * 0.7}
                strokeWidth={0.6 + (v / 100) * 2.8}
                markerEnd="url(#arrow)"
                style={{ transition: "all 1s" }}
              />
            );
          }),
        )}
        {PLAYER_IDS.map((p) => {
          const part = state.participants[p];
          const isSab = god && part.role === "saboteur";
          return (
            <g key={p} opacity={part.alive ? 1 : 0.35}>
              <circle cx={pos[p].x} cy={pos[p].y} r={15} fill="#0f172a" stroke={isSab ? "#ef4444" : ACCENT[part.accent].hex} strokeWidth={isSab ? 2.5 : 1.5} />
              <text x={pos[p].x} y={pos[p].y + 3.5} textAnchor="middle" fontSize="9" fontWeight="bold" fill={ACCENT[part.accent].hex}>
                {initials(part.name)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-center text-[9px] text-slate-600">arrows = who suspects whom (≥35%) · thickness = intensity</p>

      <SectionTitle icon={ShieldCheck}>SUSPICION MATRIX</SectionTitle>
      <div className="relative">
        <table className="w-full table-fixed text-[9px]">
          <thead>
            <tr>
              <th className="w-12 text-left font-normal text-slate-600">obs ↓</th>
              {PLAYER_IDS.map((t) => (
                <th key={t} className={`font-normal ${ACCENT[state.participants[t].accent].text}`}>
                  {state.participants[t].short.slice(0, 5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {observers.map((o) => (
              <tr key={o}>
                <td className={`${ACCENT[state.participants[o].accent].text} py-0.5`}>{state.participants[o].short.slice(0, 6)}</td>
                {PLAYER_IDS.map((t) => {
                  const v = state.participants[o].suspicion[t];
                  return (
                    <td key={t} className="p-0.5">
                      {o === t ? (
                        <div className="h-5 rounded bg-zinc-900" />
                      ) : (
                        <div
                          className="flex h-5 items-center justify-center rounded tabular-nums text-white/90 transition-all duration-700"
                          style={{ background: `color-mix(in srgb, ${heat(v).hex} ${Math.round(15 + v * 0.7)}%, #0f172a)` }}
                        >
                          {god ? v : "▒"}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!god && (
          <div className="absolute inset-0 flex items-center justify-center rounded bg-slate-950/40 text-[10px] text-slate-400 backdrop-blur-[1px]">
            <Lock className="mr-1 h-3 w-3" /> exact values classified
          </div>
        )}
      </div>
    </div>
  );
}
