"use client";

import { useEffect, useState } from "react";
import { Power, Shuffle, ShieldCheck, Skull, Volume2, VolumeX } from "lucide-react";
import type { RolePreference } from "@/lib/scenario-generator";

const LINES = [
  "HELIOS DEEP RESEARCH STATION // EMERGENCY KERNEL v7.3.1",
  "> mounting /sys/lockdown ................ OK",
  "> integrity scan: SECTOR BREACH DETECTED",
  "> biometric census: 5 lifesigns in LOCKDOWN ROOM",
  "> behavioural heuristics: 1 signature ANOMALOUS",
  "> loading SUSPECT PROTOCOL ..............",
  "> spinning up autonomous crew cognition cores [4/4]",
  "> cognitive telemetry uplink ............ ARMED",
  "",
  "IDENTIFY THE SABOTEUR. YOU HAVE THREE VOTES.",
];

export default function BootScreen({
  onStart,
}: {
  onStart: (opts: { callsign: string; role: RolePreference; voice: boolean }) => void;
}) {
  const [shown, setShown] = useState(0);
  const [callsign, setCallsign] = useState("Rook");
  const [role, setRole] = useState<RolePreference>("random");
  const [voiceOn, setVoiceOn] = useState(true);

  useEffect(() => {
    if (shown >= LINES.length) return;
    const t = setTimeout(() => setShown((s) => s + 1), shown === 0 ? 300 : 220 + Math.random() * 260);
    return () => clearTimeout(t);
  }, [shown]);

  const ready = shown >= LINES.length;

  return (
    <div className="grid-bg flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <h1 className="glitch mb-1 text-center text-3xl font-black tracking-[0.3em] text-cyan-300 sm:text-5xl">
          THE SUSPECT
          <br />
          PROTOCOL
        </h1>
        <p className="mb-6 text-center text-[11px] tracking-[0.4em] text-slate-500">AI SOCIAL DEDUCTION · LOCKDOWN ROOM 04</p>

        <div className="rounded-lg border border-zinc-800 bg-black/60 p-4 font-mono text-[12px] leading-relaxed shadow-[0_0_60px_rgba(34,211,238,0.08)]">
          {LINES.slice(0, shown).map((l, i) => (
            <div
              key={i}
              className={
                l.includes("ANOMALOUS") || l.includes("BREACH")
                  ? "text-red-400"
                  : l.startsWith("IDENTIFY")
                    ? "mt-1 font-bold text-amber-300"
                    : "text-emerald-400/90"
              }
            >
              {l || " "}
            </div>
          ))}
          {!ready && <span className="cursor text-emerald-400" />}
        </div>

        <div className={`mt-6 space-y-4 transition-all duration-700 ${ready ? "opacity-100" : "pointer-events-none translate-y-4 opacity-0"}`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[10px] tracking-[0.25em] text-slate-500">OPERATOR CALLSIGN</span>
              <input
                value={callsign}
                onChange={(e) => setCallsign(e.target.value.replace(/[^\w\- ]/g, "").slice(0, 16))}
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sky-300 outline-none focus:border-cyan-500"
              />
            </label>
            <div>
              <span className="text-[10px] tracking-[0.25em] text-slate-500">ROLE ASSIGNMENT</span>
              <div className="mt-1 grid grid-cols-3 gap-1">
                {(
                  [
                    ["random", Shuffle, "Random"],
                    ["innocent", ShieldCheck, "Innocent"],
                    ["saboteur", Skull, "Saboteur"],
                  ] as const
                ).map(([k, Icon, label]) => (
                  <button
                    key={k}
                    onClick={() => setRole(k)}
                    className={`flex items-center justify-center gap-1 rounded border px-2 py-2 text-[11px] transition ${
                      role === k
                        ? k === "saboteur"
                          ? "border-red-500/60 bg-red-500/15 text-red-300"
                          : "border-cyan-500/60 bg-cyan-500/15 text-cyan-300"
                        : "border-zinc-800 text-slate-500 hover:border-zinc-600"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={() => setVoiceOn(!voiceOn)}
            className="flex items-center gap-2 text-[11px] text-slate-400 hover:text-slate-200"
          >
            {voiceOn ? <Volume2 className="h-4 w-4 text-cyan-400" /> : <VolumeX className="h-4 w-4" />}
            Synthesized crew voices {voiceOn ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => onStart({ callsign: callsign || "Rook", role, voice: voiceOn })}
            className="group flex w-full items-center justify-center gap-3 rounded-lg border border-cyan-500/60 bg-cyan-500/10 py-4 text-sm font-bold tracking-[0.35em] text-cyan-200 transition hover:bg-cyan-500/20 hover:shadow-[0_0_40px_rgba(34,211,238,0.35)]"
          >
            <Power className="h-5 w-5 transition group-hover:rotate-90" /> INITIATE LOCKDOWN
          </button>
        </div>
      </div>
    </div>
  );
}
