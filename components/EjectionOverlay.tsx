"use client";

import { useEffect, useState } from "react";
import { DoorClosed, User } from "lucide-react";
import type { GameState } from "@/lib/types";
import { ACCENT } from "@/lib/ui";
import { sfx } from "@/lib/sfx";

export default function EjectionOverlay({ state, onContinue }: { state: GameState; onContinue: () => void }) {
  const result = state.results[state.results.length - 1];
  const ejected = result?.ejected ? state.participants[result.ejected] : null;
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (ejected) sfx.eject();
    else sfx.glitch();
    const timers = [
      setTimeout(() => setStage(1), ejected ? 2600 : 600),
      setTimeout(() => {
        setStage(2);
        if (ejected && result.wasSaboteur) sfx.win();
        else if (ejected) sfx.glitch();
      }, ejected ? 4400 : 1400),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black">
      <div className="starfield absolute inset-0 opacity-80" />
      {ejected && (
        <>
          <div className="drift absolute left-1/2 top-1/2 -ml-8 -mt-8">
            <div className={`flex h-16 w-16 items-center justify-center rounded-full border-2 ${ACCENT[ejected.accent].border} ${ACCENT[ejected.accent].bg}`}>
              <User className={`h-9 w-9 ${ACCENT[ejected.accent].text}`} />
            </div>
          </div>
          {/* Airlock doors */}
          <div className="door-l absolute inset-y-0 left-0 w-1/2 border-r-4 border-amber-500/70 bg-[repeating-linear-gradient(45deg,#18181b_0_18px,#27272a_18px_36px)]" />
          <div className="door-r absolute inset-y-0 right-0 w-1/2 border-l-4 border-amber-500/70 bg-[repeating-linear-gradient(-45deg,#18181b_0_18px,#27272a_18px_36px)]" />
        </>
      )}

      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
        {!ejected && (
          <div className="reveal-up">
            <DoorClosed className="mx-auto h-14 w-14 text-slate-500" />
            <p className="mt-4 text-2xl font-bold tracking-[0.2em] text-slate-300">NO MAJORITY</p>
            <p className="mt-2 text-sm text-slate-500">The airlock stays sealed. The Saboteur breathes easier.</p>
          </div>
        )}
        {ejected && stage >= 1 && (
          <p className="reveal-up text-xl font-bold text-slate-200 sm:text-3xl">
            {ejected.isHuman ? "You were" : `${ejected.name} was`} ejected into the void.
          </p>
        )}
        {ejected && stage >= 2 && (
          <p
            className={`reveal-up mt-4 text-2xl font-black sm:text-4xl ${result.wasSaboteur ? "text-emerald-400" : "glitch text-red-500"}`}
          >
            {result.wasSaboteur ? "THEY WERE THE SABOTEUR." : "THEY WERE NOT THE SABOTEUR."}
          </p>
        )}
        {stage >= 2 && (
          <button
            onClick={onContinue}
            className="msg-in mt-10 rounded-lg border border-zinc-600 bg-zinc-900/80 px-6 py-3 text-sm tracking-[0.3em] text-slate-200 transition hover:border-cyan-500 hover:text-cyan-200"
          >
            CONTINUE ▸
          </button>
        )}
      </div>
    </div>
  );
}
