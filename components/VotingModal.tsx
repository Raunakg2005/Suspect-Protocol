"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Gavel, Skull, Vote as VoteIcon } from "lucide-react";
import type { GameState, PlayerId } from "@/lib/types";
import { alive, tallyVotes } from "@/lib/game-engine";
import { ACCENT, initials } from "@/lib/ui";
import { sfx } from "@/lib/sfx";

export default function VotingModal({
  state,
  onCast,
  onResolve,
}: {
  state: GameState;
  onCast: (target: PlayerId | "skip" | null) => void;
  onResolve: () => void;
}) {
  const humanAlive = state.participants.human.alive;
  const cast = state.votes.length > 0;
  const [revealed, setRevealed] = useState(0);
  const [choice, setChoice] = useState<PlayerId | "skip" | null>(null);

  // Ghosts don't vote: cast automatically.
  useEffect(() => {
    if (!humanAlive && !cast) {
      const t = setTimeout(() => onCast(null), 600);
      return () => clearTimeout(t);
    }
  }, [humanAlive, cast, onCast]);

  // Staggered reveal
  useEffect(() => {
    if (!cast || revealed >= state.votes.length) return;
    const t = setTimeout(() => {
      setRevealed((r) => r + 1);
      sfx.vote();
    }, revealed === 0 ? 500 : 750);
    return () => clearTimeout(t);
  }, [cast, revealed, state.votes.length]);

  const shownVotes = state.votes.slice(0, revealed);
  const { tally } = useMemo(() => tallyVotes(shownVotes), [shownVotes]);
  const final = cast && revealed >= state.votes.length ? tallyVotes(state.votes) : null;
  const candidates = alive(state).filter((p) => p !== "human");
  const maxCount = Math.max(1, ...Object.values(tally).map((n) => n ?? 0));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="msg-in w-full max-w-2xl rounded-xl border border-amber-500/40 bg-slate-950 p-5 shadow-[0_0_80px_rgba(245,158,11,0.15)]">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.3em] text-amber-400">
          <Gavel className="h-4 w-4" /> ROUND {state.round} · AIRLOCK VOTE
        </div>
        <h2 className="mt-1 text-xl font-bold text-amber-200">Who goes out the airlock?</h2>

        {!cast && humanAlive && (
          <>
            <p className="mt-1 text-[12px] text-slate-400">A strict plurality that beats the skip count ejects. Ties keep the door sealed.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {candidates.map((p) => {
                const x = state.participants[p];
                const a = ACCENT[x.accent];
                return (
                  <button
                    key={p}
                    onClick={() => setChoice(p)}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-left transition ${
                      choice === p ? "border-red-500 bg-red-500/15 shadow-[0_0_20px_rgba(239,68,68,0.3)]" : "border-zinc-800 hover:border-zinc-600"
                    }`}
                  >
                    <span className={`flex h-9 w-9 items-center justify-center rounded border ${a.border} ${a.bg} ${a.text} text-xs font-bold`}>
                      {initials(x.name)}
                    </span>
                    <span>
                      <span className={`block text-[12px] font-bold ${a.text}`}>{x.short}</span>
                      <span className="block text-[10px] text-slate-500">{x.title}</span>
                    </span>
                  </button>
                );
              })}
              <button
                onClick={() => setChoice("skip")}
                className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-[12px] transition ${
                  choice === "skip" ? "border-slate-400 bg-slate-500/15" : "border-zinc-800 text-slate-400 hover:border-zinc-600"
                }`}
              >
                <Ban className="h-4 w-4" /> Skip vote
              </button>
            </div>
            <button
              disabled={!choice}
              onClick={() => choice && onCast(choice)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 py-3 text-sm font-bold tracking-[0.3em] text-amber-200 transition enabled:hover:bg-amber-500/20 disabled:opacity-30"
            >
              <VoteIcon className="h-4 w-4" /> LOCK IN VOTE
            </button>
          </>
        )}

        {!cast && !humanAlive && <p className="mt-4 text-[12px] text-slate-500">You are a ghost. The living are voting…</p>}

        {cast && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              {shownVotes.map((v) => {
                const voter = state.participants[v.voter];
                const tgt = v.target === "skip" ? null : state.participants[v.target];
                return (
                  <div key={v.voter} className="vote-in rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-[11px]">
                    <span className={ACCENT[voter.accent].text}>{voter.short}</span>
                    <span className="text-slate-500"> → </span>
                    {tgt ? <span className={`font-bold ${ACCENT[tgt.accent].text}`}>{tgt.short}</span> : <span className="text-slate-400">skip</span>}
                    <div className="text-[10px] text-slate-500">{v.reason}</div>
                  </div>
                );
              })}
              {revealed < state.votes.length && <div className="text-[11px] text-slate-500">decrypting ballots…</div>}
            </div>
            <div className="space-y-2">
              {[...alive(state), "skip" as const].map((k) => {
                const n = tally[k] ?? 0;
                const label = k === "skip" ? "SKIP" : state.participants[k].short;
                const isOut = final?.ejected === k;
                return (
                  <div key={k}>
                    <div className="flex justify-between text-[10px]">
                      <span className={isOut ? "font-bold text-red-400" : "text-slate-400"}>
                        {isOut && <Skull className="mr-1 inline h-3 w-3" />}
                        {label}
                      </span>
                      <span className="tabular-nums text-slate-300">{n}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${isOut ? "bg-red-500" : k === "skip" ? "bg-slate-500" : "bg-amber-500"}`}
                        style={{ width: `${(n / maxCount) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {final && (
          <button
            onClick={onResolve}
            className="msg-in mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/60 bg-red-500/10 py-3 text-sm font-bold tracking-[0.3em] text-red-200 transition hover:bg-red-500/20"
          >
            {final.ejected ? `CYCLE AIRLOCK — EJECT ${state.participants[final.ejected].short.toUpperCase()}` : "NO MAJORITY — CONTINUE"}
          </button>
        )}
      </div>
    </div>
  );
}
