import type { Direction, IndexPrice } from "../domain/types.js";

/**
 * Next-day direction estimate (Module D). Deliberately simple and transparent:
 * a momentum term (last value vs. three days earlier) plus a mean-reversion
 * term (last value vs. five-day average). Confidence scales with the size of
 * the signal and is capped so the UI never shows false certainty. Backtesting
 * over the stored history reports the hit rate so users can judge it.
 */

export const MODEL_VERSION = "baseline-momentum-v1";
const FLAT_BAND = 0.004; // $/gal

export interface ForecastEstimate {
  direction: Direction;
  confidence: number;
  rationale: string;
  score: number;
}

function sorted(series: IndexPrice[]): IndexPrice[] {
  return [...series].sort((a, b) => a.date.localeCompare(b.date));
}

export function estimateDirection(series: IndexPrice[]): ForecastEstimate {
  const s = sorted(series);
  if (s.length < 6) {
    return { direction: "flat", confidence: 0.5, rationale: "Not enough history (need 6 days)", score: 0 };
  }
  const last = s[s.length - 1].value;
  const threeAgo = s[s.length - 4].value;
  const ma5 = s.slice(-5).reduce((a, p) => a + p.value, 0) / 5;
  const momentum = last - threeAgo;
  const meanRev = last - ma5;
  const score = 0.6 * momentum + 0.4 * meanRev;
  const direction: Direction =
    Math.abs(score) < FLAT_BAND ? "flat" : score > 0 ? "up" : "down";
  const confidence = Math.round(
    Math.min(0.85, 0.5 + Math.min(Math.abs(score) / 0.03, 1) * 0.35) * 100,
  ) / 100;
  const rationale =
    `3-day momentum ${fmt(momentum)}, ${fmt(meanRev)} vs 5-day average ` +
    `(${fmt(ma5, false)}); combined signal ${fmt(score)} → ${direction}`;
  return { direction, confidence, rationale, score };
}

export function realizedDirection(prev: number, next: number): Direction {
  const d = next - prev;
  return Math.abs(d) < FLAT_BAND ? "flat" : d > 0 ? "up" : "down";
}

/** Walk the history and score the estimate that would have been made each day. */
export function backtest(series: IndexPrice[]): { hits: number; total: number; hitRate: number } {
  const s = sorted(series);
  let hits = 0;
  let total = 0;
  for (let i = 6; i < s.length; i++) {
    const est = estimateDirection(s.slice(0, i));
    const real = realizedDirection(s[i - 1].value, s[i].value);
    total++;
    if (est.direction === real) hits++;
  }
  return { hits, total, hitRate: total ? Math.round((hits / total) * 100) / 100 : 0 };
}

function fmt(n: number, signed = true): string {
  const s = `$${Math.abs(n).toFixed(4)}`;
  return signed ? `${n >= 0 ? "+" : "-"}${s}` : s;
}
