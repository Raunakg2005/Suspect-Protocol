"use client";

import { AlertOctagon, DoorClosed, Fingerprint, KeyRound, ScanSearch, ShieldCheck, Skull } from "lucide-react";
import type { GameState } from "@/lib/types";
import { PLAYER_IDS } from "@/lib/scenario-generator";
import { ACCENT } from "@/lib/ui";

export default function Briefing({ state, onEnter }: { state: GameState; onEnter: () => void }) {
  const me = state.participants.human;
  const sab = me.role === "saboteur";
  const s = state.scenario;

  return (
    <div className={`grid-bg flex min-h-screen items-center justify-center p-4 ${sab ? "alarm-pulse" : ""}`}>
      <div className="w-full max-w-3xl space-y-4">
        <div className="rounded-lg border border-red-500/40 bg-red-950/20 p-4">
          <div className="flex items-center gap-2 text-[10px] tracking-[0.3em] text-red-400">
            <AlertOctagon className="h-4 w-4" /> {s.code} · PRIORITY ALPHA
          </div>
          <h2 className="mt-1 text-xl font-bold text-red-200 sm:text-2xl">{s.title}</h2>
          <p className="mt-1 text-sm text-slate-300">
            {s.sector} · {s.time}. Investigators confirm {s.method}.
          </p>
          <p className="mt-1 text-sm text-amber-300">{s.consequence}</p>
          <p className="mt-2 border-t border-red-500/20 pt-2 text-[12px] text-slate-400">
            <Fingerprint className="mr-1 inline h-3.5 w-3.5" /> {s.sceneTrace}
          </p>
        </div>

        <div
          className={`reveal-up rounded-lg border p-5 ${
            sab ? "border-red-500/60 bg-red-500/10 shadow-[0_0_60px_rgba(239,68,68,0.25)]" : "border-cyan-500/50 bg-cyan-500/5 shadow-[0_0_60px_rgba(34,211,238,0.15)]"
          }`}
        >
          <div className="text-[10px] tracking-[0.3em] text-slate-500">CLASSIFIED DOSSIER — {me.name.toUpperCase()}</div>
          <div className={`mt-2 flex items-center gap-3 text-3xl font-black tracking-[0.2em] sm:text-4xl ${sab ? "glitch text-red-400" : "text-cyan-300"}`}>
            {sab ? <Skull className="h-9 w-9" /> : <ShieldCheck className="h-9 w-9" />}
            {sab ? "YOU ARE THE SABOTEUR" : "YOU ARE INNOCENT"}
          </div>
          <div className="mt-4 grid gap-3 text-[12px] sm:grid-cols-2">
            <Field label={sab ? "COVER STORY (a lie — sell it)" : "YOUR ALIBI (true)"} body={me.claimedAlibi} tone={sab ? "text-red-200" : "text-slate-200"} />
            <Field label="PRIVATE MEMORY" body={me.observation} />
            <Field label="OBJECTIVE" body={me.objective} />
            <div className="rounded border border-zinc-800 bg-black/40 p-3">
              <div className="text-[10px] tracking-[0.2em] text-slate-500">ABILITIES</div>
              {sab ? (
                <p className="mt-1 text-slate-300">
                  <KeyRound className="mr-1 inline h-3.5 w-3.5 text-red-400" />
                  <b className="text-red-300">FORGE LOG ×1</b> — plant a fake keycard record implicating anyone. The AIs will treat it as real.
                </p>
              ) : (
                <p className="mt-1 text-slate-300">
                  <ScanSearch className="mr-1 inline h-3.5 w-3.5 text-cyan-400" />
                  <b className="text-cyan-300">KEYCARD SCAN ×2</b> — query any sector&apos;s door logs around the incident. Results post publicly.
                </p>
              )}
              <p className="mt-1 text-slate-400">
                <b className="text-violet-300">WHISPER</b> — private messages to any crew member.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
          <div className="mb-2 text-[10px] tracking-[0.25em] text-slate-500">KNOWN PERSONAL TRACES (PUBLIC)</div>
          <div className="grid gap-1 text-[11px] sm:grid-cols-2">
            {PLAYER_IDS.map((p) => {
              const x = state.participants[p];
              return (
                <div key={p}>
                  <span className={ACCENT[x.accent].text}>{x.name}</span> <span className="text-slate-500">— {x.tell}</span>
                </div>
              );
            })}
          </div>
        </div>

        <button
          onClick={onEnter}
          className={`flex w-full items-center justify-center gap-3 rounded-lg border py-4 text-sm font-bold tracking-[0.35em] transition ${
            sab
              ? "border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20"
              : "border-cyan-500/60 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
          }`}
        >
          <DoorClosed className="h-5 w-5" /> ENTER THE LOCKDOWN ROOM
        </button>
      </div>
    </div>
  );
}

function Field({ label, body, tone = "text-slate-300" }: { label: string; body: string; tone?: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-black/40 p-3">
      <div className="text-[10px] tracking-[0.2em] text-slate-500">{label}</div>
      <p className={`mt-1 leading-relaxed ${tone}`}>{body}</p>
    </div>
  );
}
