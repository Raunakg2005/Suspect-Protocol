import type { Accent } from "./types";

export const ACCENT: Record<Accent, { text: string; bg: string; border: string; dot: string; hex: string }> = {
  cyan: { text: "text-cyan-300", bg: "bg-cyan-500/10", border: "border-cyan-500/40", dot: "bg-cyan-400", hex: "#22d3ee" },
  emerald: { text: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/40", dot: "bg-emerald-400", hex: "#34d399" },
  violet: { text: "text-violet-300", bg: "bg-violet-500/10", border: "border-violet-500/40", dot: "bg-violet-400", hex: "#a78bfa" },
  amber: { text: "text-amber-300", bg: "bg-amber-500/10", border: "border-amber-500/40", dot: "bg-amber-400", hex: "#fbbf24" },
  sky: { text: "text-sky-300", bg: "bg-sky-500/10", border: "border-sky-500/40", dot: "bg-sky-400", hex: "#38bdf8" },
};

/** 0-100 suspicion → color class */
export function heat(v: number) {
  if (v >= 70) return { bar: "bg-red-500", text: "text-red-400", hex: "#ef4444" };
  if (v >= 50) return { bar: "bg-amber-500", text: "text-amber-400", hex: "#f59e0b" };
  if (v >= 30) return { bar: "bg-yellow-400/80", text: "text-yellow-300", hex: "#facc15" };
  return { bar: "bg-emerald-500", text: "text-emerald-400", hex: "#10b981" };
}

const GLYPHS = "▓▒░█▌▐■□◆◇○●◘◙☰☷⌬⍟⎔⏣";
/** Deterministic scramble so encrypted text doesn't jitter on every render */
export function scramble(text: string, seed = 0) {
  let h = seed;
  return text
    .split("")
    .map((c) => {
      if (c === " ") return " ";
      h = (h * 31 + c.charCodeAt(0)) % 9973;
      return GLYPHS[h % GLYPHS.length];
    })
    .join("");
}

export function initials(name: string) {
  const parts = name.replace(/^(Dr\.|Operator)\s+/, "").split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? parts[0][1] ?? "")).toUpperCase();
}
