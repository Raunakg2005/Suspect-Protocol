"use client";

import { RotateCcw, ShieldCheck, Skull, Trophy } from "lucide-react";
import type { GameState } from "@/lib/types";
import { PLAYER_IDS } from "@/lib/scenario-generator";
import { ACCENT } from "@/lib/ui";

export default function Debrief({ state, onRestart }: { state: GameState; onRestart: () => void }) {
  const me = state.participants.human;
  const humanWon = (state.winner === "innocents") === (me.role === "innocent");
  const lies = state.messages.filter((m) => m.kind === "public" && m.deception);
  const forged = state.messages.filter((m) => m.forged);
  const thoughtFor = (thoughtId?: string) => state.thoughts.find((t) => t.id === thoughtId);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/95 p-4 backdrop-blur">
      <div className="mx-auto max-w-4xl space-y-4 py-6">
        <div className={`reveal-up rounded-xl border p-6 text-center ${humanWon ? "border-emerald-500/50 bg-emerald-500/5" : "border-red-500/50 bg-red-500/5"}`}>
          <Trophy className={`mx-auto h-10 w-10 ${humanWon ? "text-emerald-400" : "text-red-400"}`} />
          <h1 className={`mt-2 text-3xl font-black tracking-[0.2em] sm:text-4xl ${humanWon ? "text-emerald-300" : "glitch text-red-400"}`}>
            {humanWon ? "MISSION SUCCESS" : "MISSION FAILED"}
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            {state.winner === "innocents" ? "Innocents win." : "The Saboteur wins."} {state.winReason}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {state.scenario.code} · seed {state.scenario.seed} · {state.stats.llmCalls} LLM turns / {state.stats.mockCalls} offline turns
          </p>
        </div>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
          <h2 className="mb-3 text-[11px] font-bold tracking-[0.25em] text-slate-400">GROUND TRUTH</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {PLAYER_IDS.map((p) => {
              const x = state.participants[p];
              const sab = x.role === "saboteur";
              const nLies = state.messages.filter((m) => m.sender === p && m.deception).length;
              return (
                <div key={p} className={`rounded border p-3 text-[11px] ${sab ? "border-red-500/50 bg-red-500/5" : "border-zinc-800"}`}>
                  <div className="flex items-center gap-2">
                    {sab ? <Skull className="h-4 w-4 text-red-400" /> : <ShieldCheck className="h-4 w-4 text-cyan-400" />}
                    <span className={`font-bold ${ACCENT[x.accent].text}`}>{x.name}</span>
                    <span className={`ml-auto rounded px-1.5 text-[9px] ${sab ? "bg-red-500/20 text-red-300" : "bg-cyan-500/15 text-cyan-300"}`}>
                      {sab ? "SABOTEUR" : "INNOCENT"}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-400">
                    Claimed: <span className="text-slate-300">{x.claimedAlibi}</span>
                  </p>
                  <p className="text-slate-400">
                    Actually: <span className={sab ? "text-red-300" : "text-slate-300"}>{x.trueLocation}</span>
                  </p>
                  <p className="text-slate-500">
                    {x.alive ? "Survived" : `Ejected round ${x.eliminatedRound}`} · {nLies} deceptive statement{nLies === 1 ? "" : "s"}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
          <h2 className="mb-3 text-[11px] font-bold tracking-[0.25em] text-red-400">LIE LEDGER · {lies.length + forged.length} DECEPTIONS</h2>
          {!lies.length && !forged.length && <p className="text-[12px] text-slate-500">Nobody lied. Suspicious in itself.</p>}
          <div className="space-y-2">
            {forged.map((m) => (
              <div key={m.id} className="rounded border border-red-500/40 bg-red-500/5 p-2 text-[11px]">
                <span className="font-bold text-red-300">FORGED EVIDENCE</span> <span className="text-slate-400">R{m.round}</span>
                <p className="text-slate-300">{m.text}</p>
              </div>
            ))}
            {lies.map((m) => {
              const x = state.participants[m.sender as keyof typeof state.participants];
              const t = thoughtFor(m.thoughtId);
              return (
                <div key={m.id} className="rounded border border-zinc-800 p-2 text-[11px]">
                  <span className={`font-bold ${ACCENT[x.accent].text}`}>{x.short}</span> <span className="text-slate-500">R{m.round} said:</span>
                  <p className="text-slate-200">“{m.text}”</p>
                  {t && <p className="mt-1 border-l-2 border-red-500/50 pl-2 text-slate-400">thinking: {t.thought}</p>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
          <h2 className="mb-3 text-[11px] font-bold tracking-[0.25em] text-amber-400">VOTE HISTORY</h2>
          {state.results.map((r) => (
            <div key={r.round} className="mb-2 text-[11px]">
              <span className="text-slate-400">Round {r.round}: </span>
              {r.votes.map((v) => `${state.participants[v.voter].short}→${v.target === "skip" ? "skip" : state.participants[v.target].short}`).join(", ")}
              <span className={r.wasSaboteur ? "text-emerald-400" : "text-red-400"}>
                {" "}
                ⇒ {r.ejected ? `${state.participants[r.ejected].short} ejected${r.wasSaboteur ? " (SABOTEUR)" : " (innocent)"}` : "no ejection"}
              </span>
            </div>
          ))}
        </section>

        <button
          onClick={onRestart}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/60 bg-cyan-500/10 py-4 text-sm font-bold tracking-[0.35em] text-cyan-200 transition hover:bg-cyan-500/20"
        >
          <RotateCcw className="h-4 w-4" /> NEW LOCKDOWN
        </button>
      </div>
    </div>
  );
}
