"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  FileWarning,
  Gavel,
  Ghost,
  Hand,
  KeyRound,
  Lock,
  Mic,
  Pause,
  Play,
  RotateCcw,
  ScanSearch,
  Send,
  Skull,
  Terminal,
  Volume2,
  VolumeX,
  Wind,
} from "lucide-react";
import BootScreen from "@/components/BootScreen";
import Briefing from "@/components/Briefing";
import CognitiveHud from "@/components/CognitiveHud";
import Debrief from "@/components/Debrief";
import EjectionOverlay from "@/components/EjectionOverlay";
import VotingModal from "@/components/VotingModal";
import { buildAgentRequest, computeAgentVotes, gameReducer } from "@/lib/game-engine";
import { mockAgentTurn } from "@/lib/mock-brain";
import { createGame, PLAYER_IDS, type RolePreference } from "@/lib/scenario-generator";
import { sfx, voice } from "@/lib/sfx";
import type { AgentTurnResult, ChatMessage, GameState, PlayerId, ProviderStatus } from "@/lib/types";
import { ACCENT, initials } from "@/lib/ui";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Home() {
  const [booted, setBooted] = useState(false);
  const [state, dispatch] = useReducer(gameReducer, undefined, () => createGame({ seed: 1 }));
  const stateRef = useRef<GameState>(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const [setup, setSetup] = useState<{ callsign: string; role: RolePreference }>({ callsign: "Rook", role: "random" });
  const [provider, setProvider] = useState<(ProviderStatus & { cooldown?: string | null }) | null>(null);
  const [offline, setOffline] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [sfxOn, setSfxOn] = useState(true);
  const gen = useRef(0); // bumps on restart to discard in-flight turns
  const inflight = useRef<string | null>(null);

  // Provider status (and refresh it periodically to surface cooldowns)
  useEffect(() => {
    const load = () =>
      fetch("/api/agent/turn")
        .then((r) => r.json())
        .then(setProvider)
        .catch(() => setProvider({ provider: "offline", model: "unreachable" }));
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    sfx.enabled = sfxOn;
  }, [sfxOn]);
  useEffect(() => {
    voice.enabled = voiceOn;
    if (!voiceOn) voice.stop();
  }, [voiceOn]);

  // ─── Orchestration loop ─────────────────────────────────
  useEffect(() => {
    if (!booted || state.phase !== "discussion" || state.busy || state.awaitingHuman || speaking) return;
    const next = state.turnQueue[0];
    if (!next) {
      const t = setTimeout(() => dispatch({ type: "START_VOTING" }), 1200);
      return () => clearTimeout(t);
    }
    if (next === "human") {
      if (state.participants.human.alive) {
        dispatch({ type: "AWAIT_HUMAN" });
        sfx.blip();
      } else dispatch({ type: "SKIP_TURN" });
      return;
    }
    if (!state.participants[next].alive) {
      dispatch({ type: "SKIP_TURN" });
      return;
    }
    if (paused) return;

    const key = `${gen.current}:${state.round}:${state.thoughts.length}:${next}`;
    if (inflight.current === key) return; // StrictMode double-invoke guard
    inflight.current = key;
    const myGen = gen.current;
    dispatch({ type: "SET_BUSY", speaker: next });

    (async () => {
      const req = buildAgentRequest(stateRef.current, next, offline);
      const minDelay = sleep(900 + Math.random() * 700);
      let result: AgentTurnResult;
      const t0 = performance.now();
      try {
        const res = await fetch("/api/agent/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        result = await res.json();
      } catch (e) {
        // Server unreachable → run the offline brain right here in the browser.
        result = {
          action: mockAgentTurn(req),
          source: "mock",
          provider: "client-offline",
          latencyMs: Math.round(performance.now() - t0),
          error: e instanceof Error ? e.message : "network error",
        };
      }
      await minDelay;
      if (myGen !== gen.current) return;
      dispatch({ type: "AGENT_TURN", agentId: next, result });

      const p = stateRef.current.participants[next];
      if (voice.enabled) {
        setSpeaking(true);
        await voice.speak(result.action.public_speech, { ...p.voice, index: PLAYER_IDS.indexOf(next) * 3 });
        if (myGen === gen.current) setSpeaking(false);
      }
    })();
  }, [booted, state.phase, state.busy, state.awaitingHuman, state.turnQueue, state.participants, state.round, state.thoughts.length, paused, speaking, offline]);

  // SFX on new messages
  const lastLen = useRef(0);
  useEffect(() => {
    const fresh = state.messages.slice(lastLen.current);
    lastLen.current = state.messages.length;
    for (const m of fresh) {
      if (m.kind === "evidence") sfx.evidence();
      else if (m.kind === "whisper" && (m.to === "human" || state.godMode)) sfx.whisper();
      else if (m.kind === "public" && m.sender !== "human") sfx.blip();
    }
  }, [state.messages, state.godMode]);

  useEffect(() => {
    if (state.phase === "voting") sfx.alarm();
    if (state.phase === "ended") {
      const won = (state.winner === "innocents") === (state.participants.human.role === "innocent");
      if (won) sfx.win();
      else sfx.lose();
    }
  }, [state.phase, state.winner, state.participants.human.role]);

  // ─── Handlers ───────────────────────────────────────────
  const start = (opts: { callsign: string; role: RolePreference; voice: boolean }) => {
    sfx.boot();
    setSetup({ callsign: opts.callsign, role: opts.role });
    setVoiceOn(opts.voice);
    gen.current++;
    dispatch({ type: "LOAD", state: createGame({ callsign: opts.callsign, humanRole: opts.role }) });
    setBooted(true);
  };

  const restart = () => {
    gen.current++;
    voice.stop();
    setSpeaking(false);
    setPaused(false);
    inflight.current = null;
    dispatch({ type: "LOAD", state: createGame({ callsign: setup.callsign, humanRole: setup.role }) });
  };

  const castVotes = useCallback((target: PlayerId | "skip" | null) => {
    const s = stateRef.current;
    const votes = [
      ...(s.participants.human.alive && target ? [{ voter: "human" as PlayerId, target, reason: "Operator's call." }] : []),
      ...computeAgentVotes(s),
    ];
    dispatch({ type: "CAST_VOTES", votes });
  }, []);

  const callVoteNow = () => {
    gen.current++;
    voice.stop();
    setSpeaking(false);
    inflight.current = null;
    dispatch({ type: "START_VOTING" });
  };

  if (!booted) return <BootScreen onStart={start} />;
  if (state.phase === "briefing")
    return (
      <Briefing
        state={state}
        onEnter={() => {
          sfx.alarm();
          dispatch({ type: "BEGIN_DISCUSSION" });
        }}
      />
    );

  const humanDead = !state.participants.human.alive;
  const oxygen = Math.max(9, Math.round(100 - state.thoughts.length * 2.4 - (state.round - 1) * 6));

  return (
    <main className={`grid-bg flex h-screen flex-col overflow-hidden ${state.round === state.maxRounds && state.phase === "discussion" ? "alarm-pulse" : ""}`}>
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-800 bg-slate-950/90 px-4 py-2">
        <h1 className="glitch text-sm font-black tracking-[0.3em] text-cyan-300">THE SUSPECT PROTOCOL</h1>
        <span className="hidden text-[10px] tracking-widest text-red-400 md:inline">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          {state.scenario.code} · {state.scenario.headline.toUpperCase()}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400" title="Room oxygen">
            <Wind className="h-3.5 w-3.5" />
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full transition-all duration-1000 ${oxygen > 50 ? "bg-cyan-400" : oxygen > 25 ? "bg-amber-400" : "bg-red-500"}`}
                style={{ width: `${oxygen}%` }}
              />
            </div>
            <span className="tabular-nums">O₂ {oxygen}%</span>
          </div>
          <IconBtn on={!paused} onClick={() => setPaused(!paused)} title={paused ? "Resume agents" : "Pause agents"}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </IconBtn>
          <IconBtn on={voiceOn} onClick={() => setVoiceOn(!voiceOn)} title="Synthesized crew voices">
            <Mic className="h-4 w-4" />
          </IconBtn>
          <IconBtn on={sfxOn} onClick={() => setSfxOn(!sfxOn)} title="Sound effects">
            {sfxOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </IconBtn>
          <IconBtn on={false} onClick={restart} title="New lockdown">
            <RotateCcw className="h-4 w-4" />
          </IconBtn>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[20%_55%_25%] lg:overflow-hidden">
        <Roster state={state} dispatch={dispatch} />
        <CenterPanel state={state} dispatch={dispatch} paused={paused} onCallVote={callVoteNow} humanDead={humanDead} />
        <div className="min-h-[70vh] lg:min-h-0">
          <CognitiveHud
            state={state}
            onToggleGod={() => dispatch({ type: "TOGGLE_GOD" })}
            provider={provider}
            offline={offline}
            onToggleOffline={() => setOffline(!offline)}
            godLocked={humanDead}
          />
        </div>
      </div>

      {state.phase === "voting" && <VotingModal key={`vote-${state.round}`} state={state} onCast={castVotes} onResolve={() => dispatch({ type: "RESOLVE_VOTE" })} />}
      {state.phase === "ejection" && <EjectionOverlay key={`eject-${state.round}`} state={state} onContinue={() => dispatch({ type: "AFTER_EJECTION" })} />}
      {state.phase === "ended" && <Debrief state={state} onRestart={restart} />}
    </main>
  );
}

// ─── Small bits ──────────────────────────────────────────────

function IconBtn({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded border p-1.5 transition ${on ? "border-cyan-500/40 text-cyan-300" : "border-zinc-800 text-slate-500 hover:text-slate-300"}`}
    >
      {children}
    </button>
  );
}

type Dispatch = React.Dispatch<Parameters<typeof gameReducer>[1]>;

// ─── Left: roster + dossier ──────────────────────────────────

function Roster({ state, dispatch }: { state: GameState; dispatch: Dispatch }) {
  const god = state.godMode;
  const me = state.participants.human;
  const [openMem, setOpenMem] = useState<PlayerId | null>(null);
  const [scanSector, setScanSector] = useState(state.scenario.sector);
  const [forgeTarget, setForgeTarget] = useState<PlayerId>("vance");

  return (
    <aside className="thin-scroll flex min-h-0 flex-col gap-2 overflow-y-auto border-r border-zinc-800 bg-slate-950/80 p-3">
      <h2 className="text-[10px] font-bold tracking-[0.25em] text-slate-500">CREW MANIFEST</h2>
      {PLAYER_IDS.map((p) => {
        const x = state.participants[p];
        const a = ACCENT[x.accent];
        const speaking = state.activeSpeaker === p;
        const showRole = god || p === "human";
        const sab = x.role === "saboteur";
        const lying = god && sab && x.claimedAlibi && !x.claimedAlibi.includes(x.trueLocation);
        return (
          <div
            key={p}
            className={`rounded-lg border p-2 transition-all duration-500 ${
              !x.alive
                ? "border-zinc-900 opacity-40 grayscale"
                : speaking
                  ? `${a.border} ${a.bg} shadow-[0_0_20px_rgba(34,211,238,0.12)]`
                  : god && sab
                    ? "border-red-500/50 bg-red-500/5"
                    : "border-zinc-800 bg-zinc-900/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <div className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${a.border} ${a.bg} ${a.text} text-xs font-bold`}>
                {x.alive ? initials(x.name) : <Skull className="h-4 w-4" />}
                {speaking && <span className={`glow-pulse absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ${a.dot}`} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className={`truncate text-[12px] font-bold ${a.text}`}>{x.name}</div>
                <div className="truncate text-[10px] text-slate-500">{x.title}</div>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1 text-[9px]">
              <span className={`rounded px-1.5 py-0.5 ${x.alive ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-slate-500"}`}>
                {x.alive ? "ALIVE" : `EJECTED R${x.eliminatedRound}`}
              </span>
              {showRole ? (
                <span className={`rounded px-1.5 py-0.5 font-bold ${sab ? "bg-red-500/20 text-red-300" : "bg-cyan-500/15 text-cyan-300"}`}>
                  {sab ? "SABOTEUR" : "INNOCENT"}
                </span>
              ) : (
                <span className="flex items-center gap-0.5 rounded bg-zinc-800 px-1.5 py-0.5 text-slate-500">
                  <Lock className="h-2.5 w-2.5" /> ROLE ??
                </span>
              )}
              {speaking && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-slate-300">{p === "human" ? "YOUR FLOOR" : "SPEAKING"}</span>}
            </div>
            {(god || p === "human") && (
              <>
                <button onClick={() => setOpenMem(openMem === p ? null : p)} className="mt-1.5 flex items-center gap-1 text-[9px] text-slate-500 hover:text-slate-300">
                  <ChevronDown className={`h-3 w-3 transition ${openMem === p ? "rotate-180" : ""}`} /> private memory
                </button>
                {openMem === p && (
                  <div className="msg-in mt-1 space-y-1 rounded bg-black/40 p-1.5 text-[10px] leading-snug">
                    <p className="text-slate-400">
                      <span className="text-slate-500">Claims:</span> {x.claimedAlibi}
                    </p>
                    <p className={lying ? "text-red-300" : "text-slate-400"}>
                      <span className="text-slate-500">Truth:</span> {x.trueLocation}
                      {lying && " ⚠ ALIBI FALSE"}
                    </p>
                    <p className="text-slate-400">{x.observation}</p>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* Abilities */}
      {me.alive && state.phase === "discussion" && (
        <div className="mt-1 rounded-lg border border-zinc-800 bg-zinc-950/70 p-2">
          <h3 className="mb-1.5 text-[10px] font-bold tracking-[0.2em] text-slate-500">OPERATOR TOOLS</h3>
          {me.role === "innocent" ? (
            <>
              <div className="text-[10px] text-slate-400">
                <ScanSearch className="mr-1 inline h-3 w-3 text-cyan-400" /> Keycard scan · {state.abilities.scansLeft} left
              </div>
              <select
                value={scanSector}
                onChange={(e) => setScanSector(e.target.value)}
                className="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[10px] text-slate-300"
              >
                {state.scenario.sectors.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <button
                disabled={state.abilities.scansLeft <= 0}
                onClick={() => dispatch({ type: "SCAN", sector: scanSector })}
                className="mt-1 w-full rounded border border-cyan-500/40 bg-cyan-500/10 py-1 text-[10px] tracking-widest text-cyan-300 transition enabled:hover:bg-cyan-500/20 disabled:opacity-30"
              >
                RUN SCAN
              </button>
            </>
          ) : (
            <>
              <div className="text-[10px] text-slate-400">
                <KeyRound className="mr-1 inline h-3 w-3 text-red-400" /> Forge keycard log · {state.abilities.forgesLeft} left
              </div>
              <select
                value={forgeTarget}
                onChange={(e) => setForgeTarget(e.target.value as PlayerId)}
                className="mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[10px] text-slate-300"
              >
                {PLAYER_IDS.filter((p) => p !== "human" && state.participants[p].alive).map((p) => (
                  <option key={p} value={p}>
                    Frame {state.participants[p].name}
                  </option>
                ))}
              </select>
              <button
                disabled={state.abilities.forgesLeft <= 0}
                onClick={() => dispatch({ type: "FORGE", target: forgeTarget })}
                className="mt-1 w-full rounded border border-red-500/40 bg-red-500/10 py-1 text-[10px] tracking-widest text-red-300 transition enabled:hover:bg-red-500/20 disabled:opacity-30"
              >
                PLANT EVIDENCE
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

// ─── Center: banner, chat, input ─────────────────────────────

function CenterPanel({
  state,
  dispatch,
  paused,
  onCallVote,
  humanDead,
}: {
  state: GameState;
  dispatch: Dispatch;
  paused: boolean;
  onCallVote: () => void;
  humanDead: boolean;
}) {
  const [text, setText] = useState("");
  const [to, setTo] = useState<PlayerId | "all">("all");
  const endRef = useRef<HTMLDivElement>(null);
  const god = state.godMode;

  const visible = state.messages.filter(
    (m) => m.kind !== "whisper" || m.to === "human" || m.sender === "human" || god,
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visible.length, state.activeSpeaker]);

  const send = () => {
    const t = text.trim();
    if (!t || humanDead) return;
    dispatch({ type: "HUMAN_MESSAGE", text: t, to: to === "all" ? undefined : to });
    sfx.send();
    setText("");
  };

  const speaker = state.activeSpeaker ? state.participants[state.activeSpeaker] : null;
  const queue = state.turnQueue.slice(state.busy || state.awaitingHuman ? 1 : 0, 6);
  const aliveAgents = PLAYER_IDS.filter((p) => p !== "human" && state.participants[p].alive);
  const chips = [
    `Where exactly were you at ${state.scenario.time}?`,
    "Who can vouch for your alibi?",
    `Whose trace is really at ${state.scenario.sector}?`,
  ];

  return (
    <section className="flex min-h-[80vh] flex-col border-zinc-800 lg:min-h-0">
      {/* Round banner */}
      <div className="border-b border-zinc-800 bg-slate-950/70 px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {Array.from({ length: state.maxRounds }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 w-8 rounded-full transition-all ${
                  i + 1 < state.round ? "bg-slate-600" : i + 1 === state.round ? "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.6)]" : "bg-zinc-800"
                }`}
              />
            ))}
          </div>
          <span className="text-[11px] font-bold tracking-[0.25em] text-amber-300">
            ROUND {state.round}/{state.maxRounds} · {state.phase.toUpperCase()}
          </span>
          {paused && <span className="rounded bg-amber-500/20 px-1.5 text-[9px] text-amber-300">PAUSED</span>}
          {state.phase === "discussion" && (
            <button
              onClick={onCallVote}
              className="ml-auto flex items-center gap-1 rounded border border-amber-500/40 px-2 py-0.5 text-[10px] tracking-wider text-amber-300 transition hover:bg-amber-500/10"
            >
              <Gavel className="h-3 w-3" /> CALL VOTE NOW
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1 overflow-hidden text-[10px] text-slate-500">
          <span>queue:</span>
          {queue.length === 0 && <span className="text-amber-400">vote imminent</span>}
          {queue.map((q, i) => (
            <span key={i} className={q === "human" ? "text-sky-300" : ACCENT[state.participants[q].accent].text}>
              {q === "human" ? "YOU" : state.participants[q].short}
              {i < queue.length - 1 && <span className="text-slate-700"> ›</span>}
            </span>
          ))}
        </div>
      </div>

      {/* Chat */}
      <div className="thin-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
        {visible.map((m) => (
          <Message key={m.id} m={m} state={state} />
        ))}
        {state.busy && speaker && !speaker.isHuman && (
          <div className="msg-in flex items-center gap-2 text-[11px] text-slate-500">
            <span className={`flex h-7 w-7 items-center justify-center rounded border ${ACCENT[speaker.accent].border} ${ACCENT[speaker.accent].bg} ${ACCENT[speaker.accent].text} text-[10px] font-bold`}>
              {initials(speaker.name)}
            </span>
            <span className={ACCENT[speaker.accent].text}>{speaker.short}</span> is composing
            <span className="flex gap-0.5">
              <span className="typing-dot h-1 w-1 rounded-full bg-slate-400" />
              <span className="typing-dot h-1 w-1 rounded-full bg-slate-400" />
              <span className="typing-dot h-1 w-1 rounded-full bg-slate-400" />
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className={`border-t p-3 transition ${state.awaitingHuman ? "border-sky-500/60 bg-sky-500/5" : "border-zinc-800 bg-slate-950/80"}`}>
        {humanDead ? (
          <div className="flex items-center justify-center gap-2 py-2 text-[12px] text-slate-500">
            <Ghost className="h-4 w-4" /> You were ejected. Spectating in God Mode.
          </div>
        ) : (
          <>
            {state.awaitingHuman && (
              <div className="mb-2 flex items-center justify-between text-[11px]">
                <span className="glow-pulse font-bold tracking-widest text-sky-300">▸ THE FLOOR IS YOURS, OPERATOR</span>
                <button
                  onClick={() => dispatch({ type: "HUMAN_YIELD" })}
                  className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-slate-400 hover:text-slate-200"
                >
                  <Hand className="h-3 w-3" /> Yield floor
                </button>
              </div>
            )}
            <div className="mb-2 flex flex-wrap gap-1">
              {chips.map((c) => (
                <button key={c} onClick={() => setText(c)} className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-slate-500 transition hover:border-zinc-600 hover:text-slate-300">
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <select
                value={to}
                onChange={(e) => setTo(e.target.value as PlayerId | "all")}
                className={`rounded border bg-zinc-900 px-2 text-[11px] ${to === "all" ? "border-zinc-800 text-slate-300" : "border-violet-500/60 text-violet-300"}`}
                title="Channel"
              >
                <option value="all">📢 Public</option>
                {aliveAgents.map((p) => (
                  <option key={p} value={p}>
                    🔒 Whisper {state.participants[p].short}
                  </option>
                ))}
              </select>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                disabled={state.phase !== "discussion"}
                placeholder={to === "all" ? "Address the room… (name someone to make them answer)" : `Secret message to ${state.participants[to].short}…`}
                className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-[13px] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-500/60"
              />
              <button
                onClick={send}
                disabled={!text.trim() || state.phase !== "discussion"}
                className={`flex items-center gap-1 rounded border px-3 text-[11px] font-bold tracking-wider transition disabled:opacity-30 ${
                  to === "all" ? "border-cyan-500/50 text-cyan-300 enabled:hover:bg-cyan-500/10" : "border-violet-500/50 text-violet-300 enabled:hover:bg-violet-500/10"
                }`}
              >
                <Send className="h-3.5 w-3.5" /> {to === "all" ? "SEND" : "WHISPER"}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Message({ m, state }: { m: ChatMessage; state: GameState }) {
  const god = state.godMode;

  if (m.kind === "system" || m.kind === "vote") {
    return (
      <div className="msg-in flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-200/90">
        <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span>{m.text}</span>
      </div>
    );
  }
  if (m.kind === "evidence") {
    return (
      <div className={`msg-in rounded border px-3 py-2 font-mono text-[11px] ${god && m.forged ? "border-red-500/60 bg-red-500/10" : "border-emerald-500/30 bg-emerald-500/5"}`}>
        <div className="mb-0.5 flex items-center gap-1 text-[9px] tracking-[0.25em] text-emerald-400">
          <FileWarning className="h-3 w-3" /> EVIDENCE
          {god && m.forged && <span className="ml-1 rounded bg-red-500/30 px-1 font-bold text-red-200">FORGED</span>}
        </div>
        <span className="text-emerald-200/90">{m.text}</span>
      </div>
    );
  }

  const sender = state.participants[m.sender as PlayerId];
  const a = ACCENT[sender.accent];
  const mine = m.sender === "human";
  const whisper = m.kind === "whisper";
  const target = m.to ? state.participants[m.to] : null;
  const intercepted = whisper && m.to !== "human" && m.sender !== "human";
  const lie = god && m.deception;

  return (
    <div className={`msg-in flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${a.border} ${a.bg} ${a.text} text-[10px] font-bold`}>
        {initials(sender.name)}
      </span>
      <div className={`max-w-[80%] ${mine ? "items-end text-right" : ""}`}>
        <div className={`mb-0.5 flex items-center gap-1.5 text-[10px] ${mine ? "justify-end" : ""}`}>
          <span className={`font-bold ${a.text}`}>{mine ? "You" : sender.name}</span>
          {whisper && (
            <span className="flex items-center gap-0.5 text-violet-300">
              <Lock className="h-2.5 w-2.5" />
              {intercepted ? `INTERCEPTED → ${target?.short}` : mine ? `whisper → ${target?.short}` : "whispered to you"}
            </span>
          )}
          {lie && (
            <span className="glow-pulse flex items-center gap-0.5 rounded bg-red-500/20 px-1 font-bold text-red-300">
              <AlertTriangle className="h-2.5 w-2.5" /> DECEPTION
            </span>
          )}
          {god && m.source && !mine && <span className="text-[8px] text-slate-600">{m.source === "llm" ? "llm" : "offline"}</span>}
        </div>
        <div
          className={`inline-block rounded-lg border px-3 py-2 text-left text-[13px] leading-relaxed ${
            whisper
              ? "border-dashed border-violet-500/50 bg-violet-500/10 text-violet-100"
              : mine
                ? "border-sky-500/40 bg-sky-500/10 text-sky-50"
                : lie
                  ? "border-red-500/50 bg-red-950/30 text-slate-100"
                  : "border-zinc-800 bg-zinc-900/70 text-slate-100"
          } ${intercepted ? "opacity-75" : ""}`}
        >
          {m.text}
        </div>
      </div>
    </div>
  );
}
