"use client";

import { useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Hero — split "Before / After" with no fade between cycles. The query text is
// backspaced character-by-character, then the next query is typed in. The
// previous result stays on screen during edit (mimics real editor behavior).
// ─────────────────────────────────────────────────────────────────────────────

export interface ChipDef {
  label: string;
  kind: "industry" | "revenue" | "topic";
}

export interface HeroQuery {
  naturalQuery: string;
  keywordSearch: string;
  keywordResultCount: number;
  thumbnail: string;
  title: string;
  chips: ChipDef[];
}

export const QUERIES: HeroQuery[] = [
  {
    naturalQuery: "Young male restaurant owners",
    keywordSearch: "restaurant",
    keywordResultCount: 247,
    thumbnail: "https://i.ytimg.com/vi/pobfyHIItag/maxresdefault.jpg",
    title: "How a 22 Year Old Built a $2.4M Pizza Shop",
    chips: [
      { label: "Food & Bev", kind: "industry" },
      { label: "$1–5M", kind: "revenue" },
      { label: "Male", kind: "topic" },
    ],
  },
  {
    naturalQuery: "Med spa owners doing under $5M",
    keywordSearch: "med spa",
    keywordResultCount: 0,
    thumbnail:
      "https://waegwoxdckgi9exy.public.blob.vercel-storage.com/runs/e04724f3-7706-41b9-b05d-0ceaa1fed105/final/a.png",
    title: "Why I'm Rolling Up 50 Med Spas Instead of Exiting",
    chips: [
      { label: "Wellness", kind: "industry" },
      { label: "$1–5M", kind: "revenue" },
      { label: "Roll-up", kind: "topic" },
    ],
  },
  {
    naturalQuery: "Ecommerce founders doing over $10M",
    keywordSearch: "ecommerce",
    keywordResultCount: 178,
    thumbnail:
      "https://waegwoxdckgi9exy.public.blob.vercel-storage.com/runs/ea849ab1-d01d-4823-9053-2feab0e4b563/final/a.png",
    title: "Scaling a $22M Hemp Distributor to $50M",
    chips: [
      { label: "E-commerce", kind: "industry" },
      { label: "$5–25M", kind: "revenue" },
      { label: "Scaling", kind: "topic" },
    ],
  },
  {
    naturalQuery: "Business owners over $1M dealing with churn",
    keywordSearch: "churn",
    keywordResultCount: 0,
    thumbnail:
      "https://waegwoxdckgi9exy.public.blob.vercel-storage.com/runs/9beb213a-957d-48bc-8ae8-2a349586720f/final/a.png",
    title: "He Can Double His Business Tomorrow and Won't",
    chips: [
      { label: "Wellness", kind: "industry" },
      { label: "$1–5M", kind: "revenue" },
      { label: "Retention", kind: "topic" },
    ],
  },
  {
    naturalQuery: "Business owners over $50M",
    keywordSearch: "$50M",
    keywordResultCount: 312,
    thumbnail:
      "https://waegwoxdckgi9exy.public.blob.vercel-storage.com/runs/7fd5950d-038c-43cd-8523-26163fb3d722/final/a.png",
    title: "He Sold $125M in Real Estate After I Fired Him",
    chips: [
      { label: "Real Estate", kind: "industry" },
      { label: "$25M+", kind: "revenue" },
      { label: "Male", kind: "topic" },
    ],
  },
];

// Phase timeline within one cycle (ms)
const BACKSPACE_END = 800;
const TYPE_END = 2300;
const SEARCH_END = 2700;
const HOLD_END = 5800;
const CYCLE = HOLD_END;

// Pane geometry
const PANE_W = 360;
const PANE_H = 430;
const THUMB_W = 270;
const THUMB_H = 152;
const THUMB_X = (PANE_W - THUMB_W) / 2;
const THUMB_Y = 70;

const FOLDERS: Array<{ label: string; depth: number; open?: boolean }> = [
  { label: "Workshop_2024_Q1", depth: 0 },
  { label: "Workshop_2024_Q2", depth: 0 },
  { label: "Workshop_2024_Q3", depth: 0, open: true },
  { label: "Day_1", depth: 1 },
  { label: "Day_2", depth: 1, open: true },
  { label: "AM", depth: 2 },
  { label: "PM", depth: 2 },
  { label: "Day_3", depth: 1 },
  { label: "Day_4", depth: 1 },
  { label: "B_Roll", depth: 0 },
  { label: "Raw_Footage", depth: 0 },
  { label: "Archive_2023", depth: 0 },
  { label: "Highlights", depth: 0 },
  { label: "Misc", depth: 0 },
  { label: "_OLD", depth: 0 },
];

const FILES: string[] = [
  "Day1_AM_main.mp4",
  "Day1_AM_QA_p1.mp4",
  "Day1_AM_QA_p2.mp4",
  "Day1_AM_intro.mp4",
  "Day1_AM_keynote.mp4",
  "Day1_PM_main.mp4",
  "Day1_PM_QA_p1.mp4",
  "Day1_PM_QA_p2.mp4",
  "Day1_PM_breakout.mp4",
  "Day1_outro_v1.mp4",
  "Day1_outro_v2.mp4",
  "Day2_AM_main.mp4",
  "Day2_AM_QA_p1.mp4",
  "Day2_AM_QA_p2.mp4",
  "Day2_AM_keynote.mp4",
  "Day2_PM_main.mp4",
  "Day2_PM_QA.mp4",
  "Day2_PM_workshop.mp4",
  "Day3_AM_main.mp4",
  "Day3_AM_QA.mp4",
  "Day3_AM_panel.mp4",
  "Day3_PM_main.mp4",
  "Day3_PM_QA_p1.mp4",
  "Day3_PM_QA_p2.mp4",
  "Day4_AM_keynote.mp4",
  "Day4_AM_main.mp4",
  "Day4_PM_main.mp4",
  "Day4_PM_QA.mp4",
  "highlights_v1.mp4",
  "highlights_v2.mp4",
  "social_batch_01.mp4",
  "social_batch_02.mp4",
  "raw_camA_2024.mp4",
  "raw_camB_2024.mp4",
];

type Phase = "backspace" | "type" | "search" | "show";

export default function HeroAnimation() {
  const [idx, setIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let raf = 0;
    let startTime = performance.now();
    let curIdx = 0;
    const tick = (now: number) => {
      const e = now - startTime;
      if (e >= CYCLE) {
        curIdx = (curIdx + 1) % QUERIES.length;
        setIdx(curIdx);
        startTime = now;
        setElapsed(0);
      } else {
        setElapsed(e);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const phase: Phase =
    elapsed < BACKSPACE_END
      ? "backspace"
      : elapsed < TYPE_END
        ? "type"
        : elapsed < SEARCH_END
          ? "search"
          : "show";

  const curr = QUERIES[idx];
  const prev = QUERIES[(idx - 1 + QUERIES.length) % QUERIES.length];

  // Search-box text — backspace then retype
  let leftTyped: string;
  let rightTyped: string;
  if (phase === "backspace") {
    const p = elapsed / BACKSPACE_END;
    leftTyped = prev.keywordSearch.slice(
      0,
      Math.ceil((1 - p) * prev.keywordSearch.length),
    );
    rightTyped = prev.naturalQuery.slice(
      0,
      Math.ceil((1 - p) * prev.naturalQuery.length),
    );
  } else if (phase === "type") {
    const p = (elapsed - BACKSPACE_END) / (TYPE_END - BACKSPACE_END);
    leftTyped = curr.keywordSearch.slice(
      0,
      Math.ceil(p * curr.keywordSearch.length),
    );
    rightTyped = curr.naturalQuery.slice(
      0,
      Math.ceil(p * curr.naturalQuery.length),
    );
  } else {
    leftTyped = curr.keywordSearch;
    rightTyped = curr.naturalQuery;
  }

  // The displayed result is the PREVIOUS query while the user is editing —
  // the file explorer / right pane still shows the stale prior search. Only
  // when "search" → "show" do we swap to the new query's result.
  const displayed = phase === "show" ? curr : prev;
  const showSearching = phase === "search";
  // Chips and thumbnail fade out during the searching beat, then animate
  // back in with the new result during "show". They stay visible (full
  // opacity, no transition) during backspace/type so the stale prev result
  // hangs on naturally.
  const resultVisible = phase !== "search";

  return (
    <div
      className="w-full mx-auto select-none"
      style={{ maxWidth: `${PANE_W * 2 + 24}px` }}
    >
      <div className="grid grid-cols-2 gap-5 pt-6">
        <BeforePane
          query={displayed}
          typed={leftTyped}
          showSearching={showSearching}
        />
        <AfterPane
          query={displayed}
          typed={rightTyped}
          resultVisible={resultVisible}
          showSearching={showSearching}
        />
      </div>
    </div>
  );
}

// ─── BEFORE: cluttered Windows-style file explorer ───────────────────────────

function BeforePane({
  query,
  typed,
  showSearching,
}: {
  query: HeroQuery;
  typed: string;
  showSearching: boolean;
}) {
  const noMatch = query.keywordResultCount === 0;
  const matchedFiles = noMatch ? [] : FILES.slice(0, 18);
  const overflow = noMatch ? 0 : Math.max(0, query.keywordResultCount - matchedFiles.length);

  return (
    <div
      className="relative"
      style={{ width: `${PANE_W}px`, height: `${PANE_H}px` }}
    >
      <div className="absolute -top-5 left-1 text-[11px] uppercase tracking-[0.22em] font-semibold text-zinc-400">
        Before
      </div>

      <div
        className="
          relative h-full rounded-lg overflow-hidden
          border border-zinc-300 dark:border-zinc-700
          bg-white dark:bg-zinc-900
          shadow-[0_10px_30px_rgba(0,0,0,0.18)]
        "
      >
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
          <span className="h-2 w-2 rounded-full bg-red-400" />
          <span className="h-2 w-2 rounded-full bg-yellow-400" />
          <span className="h-2 w-2 rounded-full bg-green-400" />
          <span className="ml-2 text-[10px] font-medium text-zinc-500">
            Workshops_2024_Q3
          </span>
        </div>

        {/* Address + search */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-zinc-400 text-[10px]">←</span>
          <span className="text-zinc-400 text-[10px]">→</span>
          <div className="flex-1 rounded border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-500 truncate">
            C:\Videos\Hormozi\Workshops\2024_Q3
          </div>
          <div className="rounded border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:text-zinc-300 min-w-[88px] flex items-center gap-1">
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span className="truncate leading-[1.4] py-px">
              {typed}
              <span className="animate-pulse">|</span>
            </span>
          </div>
        </div>

        {/* Body: folder tree + file list (cluttered) */}
        <div className="grid grid-cols-[96px_1fr] h-[calc(100%-66px)]">
          {/* Folder tree */}
          <div className="border-r border-zinc-200 dark:border-zinc-800 p-1.5 text-[10px] space-y-[2px] bg-zinc-50/60 dark:bg-zinc-900/50 overflow-hidden">
            {FOLDERS.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400"
                style={{ paddingLeft: `${f.depth * 8}px` }}
              >
                <span className="text-[7px] w-2 inline-block">
                  {f.open ? "▾" : "▸"}
                </span>
                <span className="text-[10px]">📁</span>
                <span className="truncate text-[9px]">{f.label}</span>
              </div>
            ))}
          </div>

          {/* File list / search result */}
          <div className="p-1.5 text-[10px] overflow-hidden relative">
            {showSearching ? (
              <div className="text-zinc-400 italic px-1 py-2 flex items-center gap-1.5">
                <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
                  <path strokeDasharray="40" strokeDashoffset="10" d="M12 2 a 10 10 0 0 1 0 20 a 10 10 0 0 1 0 -20" />
                </svg>
                Searching…
              </div>
            ) : noMatch ? (
              <div className="rounded-md px-2 py-2 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/70">
                <div className="font-semibold text-[10px]">⚠ No items match</div>
                <div className="mt-0.5 text-[9px] opacity-80">
                  Try a different keyword?
                </div>
              </div>
            ) : (
              <>
                <div className="rounded-md px-2 py-1 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/70 mb-1">
                  <div className="font-semibold text-[10px]">
                    {query.keywordResultCount} matches — too many
                  </div>
                </div>
                <div className="space-y-[2px] mt-0.5">
                  {matchedFiles.map((f, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400"
                    >
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span className="truncate text-[9px]">{f}</span>
                    </div>
                  ))}
                  {overflow > 0 && (
                    <div className="text-zinc-400 italic text-[9px] pt-0.5">
                      …and {overflow} more
                    </div>
                  )}
                </div>
                {/* Bottom fade to imply more content below */}
                <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white dark:from-zinc-900 to-transparent pointer-events-none" />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AFTER: liquid-glass search + result + floating callout chips ────────────

export const CHIP_STYLES: Record<ChipDef["kind"], string> = {
  industry:
    "bg-indigo-100/95 dark:bg-indigo-950/85 text-indigo-700 dark:text-indigo-300 border-indigo-300/80 dark:border-indigo-800/80",
  revenue:
    "bg-emerald-100/95 dark:bg-emerald-950/85 text-emerald-700 dark:text-emerald-300 border-emerald-300/80 dark:border-emerald-800/80",
  topic:
    "bg-amber-100/95 dark:bg-amber-950/85 text-amber-700 dark:text-amber-300 border-amber-300/80 dark:border-amber-800/80",
};

export const CHIP_LABELS: Record<ChipDef["kind"], string> = {
  industry: "Industry",
  revenue: "Revenue",
  topic: "Topic",
};

function AfterPane({
  query,
  typed,
  resultVisible,
  showSearching,
}: {
  query: HeroQuery;
  typed: string;
  resultVisible: boolean;
  showSearching: boolean;
}) {
  // Chips in three evenly-spaced slots below the thumb. Lines drop straight
  // down from the thumb's bottom edge to the chip top — cleanest possible
  // connector since the chip cx equals the thumb anchor tx.
  const CHIP_ROW_Y = 290;
  const SLOT_FRACTIONS = [0.18, 0.5, 0.82];
  const chipAnchors = SLOT_FRACTIONS.map((f) => {
    const x = PANE_W * f;
    return {
      cx: x,
      cy: CHIP_ROW_Y,
      tx: x,
      ty: THUMB_Y + THUMB_H,
    };
  });

  return (
    <div
      className="relative"
      style={{ width: `${PANE_W}px`, height: `${PANE_H}px` }}
    >
      <div className="absolute -top-5 left-1 text-[11px] uppercase tracking-[0.22em] font-semibold text-indigo-500 dark:text-indigo-400">
        After
      </div>

      {/* Soft radial glow */}
      <div
        aria-hidden
        className="absolute inset-0 blur-3xl opacity-70 pointer-events-none -z-10"
        style={{
          background:
            "radial-gradient(circle at 50% 40%, rgba(99,102,241,0.32), transparent 65%), radial-gradient(circle at 70% 80%, rgba(244,114,182,0.20), transparent 60%)",
        }}
      />

      <div
        className="
          relative h-full rounded-lg overflow-visible
          border border-zinc-200/70 dark:border-zinc-700/70
          bg-gradient-to-br from-white via-indigo-50/30 to-pink-50/30
          dark:from-zinc-900 dark:via-indigo-950/30 dark:to-pink-950/30
          shadow-[0_10px_30px_rgba(99,102,241,0.20)]
        "
      >
        {/* Liquid-glass search bar */}
        <div className="absolute left-3 right-3 top-3">
          <div
            className="
              flex items-center gap-2 rounded-full px-3.5 py-2.5
              backdrop-blur-2xl
              bg-white/75 dark:bg-zinc-900/70
              border border-white/85 dark:border-zinc-700/70
              shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_4px_24px_rgba(99,102,241,0.22)]
            "
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-zinc-600 dark:text-zinc-400 shrink-0"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span className="text-[12px] font-medium text-zinc-900 dark:text-zinc-50 truncate leading-[1.4] py-px">
              {typed}
              <span className="animate-pulse">|</span>
            </span>
          </div>
        </div>

        {/* SVG layer for connector lines */}
        <svg
          className="absolute inset-0 pointer-events-none"
          viewBox={`0 0 ${PANE_W} ${PANE_H}`}
          width={PANE_W}
          height={PANE_H}
          aria-hidden
        >
          {chipAnchors.map((a, i) => {
            const chipTopY = a.cy - 24;
            return (
              <g
                key={i}
                style={{
                  opacity: resultVisible ? 1 : 0,
                  transition: `opacity 350ms ease-out ${i * 90}ms`,
                }}
              >
                <line
                  x1={a.cx}
                  y1={chipTopY}
                  x2={a.tx}
                  y2={a.ty + 2}
                  stroke="rgba(99,102,241,0.55)"
                  strokeWidth="1.4"
                  strokeDasharray="4 4"
                />
                <circle
                  cx={a.tx}
                  cy={a.ty}
                  r={3}
                  fill="rgba(99,102,241,0.85)"
                />
              </g>
            );
          })}
        </svg>

        {/* Thumbnail */}
        <div
          className="absolute rounded-lg overflow-hidden ring-1 ring-black/10 dark:ring-white/10 shadow-xl bg-zinc-200 dark:bg-zinc-800 transition-all duration-300 ease-out"
          style={{
            left: `${THUMB_X}px`,
            top: `${THUMB_Y}px`,
            width: `${THUMB_W}px`,
            height: `${THUMB_H}px`,
            opacity: resultVisible ? 1 : 0,
            transform: resultVisible ? "scale(1)" : "scale(0.94)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={query.thumbnail}
            alt={query.title}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Searching spinner overlay */}
        {showSearching && (
          <div
            className="absolute flex items-center justify-center"
            style={{
              left: `${THUMB_X}px`,
              top: `${THUMB_Y}px`,
              width: `${THUMB_W}px`,
              height: `${THUMB_H}px`,
            }}
          >
            <div className="flex items-center gap-2 rounded-full bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md border border-white/80 dark:border-zinc-700/80 px-3 py-1.5 shadow-md">
              <svg
                className="animate-spin text-indigo-500"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                aria-hidden
              >
                <path
                  strokeDasharray="40"
                  strokeDashoffset="10"
                  d="M12 2 a 10 10 0 0 1 0 20 a 10 10 0 0 1 0 -20"
                />
              </svg>
              <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
                Searching…
              </span>
            </div>
          </div>
        )}

        {/* Try this query CTA — submits the hero search form with the
            currently-displayed natural-language query. Uses requestSubmit so
            the SearchProgressBar's submit listener fires. */}
        <button
          type="button"
          onClick={() => {
            const form = document.querySelector(
              "form.hero-form",
            ) as HTMLFormElement | null;
            if (!form) return;
            const input = form.querySelector(
              'input[name="q"]',
            ) as HTMLInputElement | null;
            if (input) input.value = query.naturalQuery;
            // Reset filter selects so the natural-language extractor drives
            // them — otherwise stale filter selections from a prior search
            // would override what the query implies.
            form.querySelectorAll("select").forEach((sel) => {
              (sel as HTMLSelectElement).value = "";
            });
            form.requestSubmit();
          }}
          className="absolute left-1/2 -translate-x-1/2 inline-flex items-center gap-2 rounded-full bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 px-6 py-3 text-base font-semibold shadow-[0_8px_28px_rgba(99,102,241,0.4)] hover:scale-[1.04] hover:shadow-[0_12px_36px_rgba(99,102,241,0.55)] active:scale-100 transition-all duration-200"
          style={{
            top: "360px",
            transition:
              "transform 200ms ease-out, box-shadow 200ms ease-out",
          }}
        >
          Try this query
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>

        {/* Floating callout chips (larger) */}
        {query.chips.map((c, i) => {
          const a = chipAnchors[i];
          if (!a) return null;
          return (
            <div
              key={`${c.kind}-${c.label}-${i}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
              style={{
                left: `${a.cx}px`,
                top: `${a.cy}px`,
                opacity: resultVisible ? 1 : 0,
                transform: resultVisible
                  ? "translate(-50%, -50%) scale(1)"
                  : "translate(-50%, -50%) scale(0.85) translateY(8px)",
                transitionDelay: `${i * 100}ms`,
              }}
            >
              <div
                className={`
                  inline-flex flex-col items-start gap-0 rounded-lg px-3 py-2
                  border backdrop-blur-md
                  shadow-[0_6px_20px_rgba(0,0,0,0.12)]
                  whitespace-nowrap
                  ${CHIP_STYLES[c.kind]}
                `}
              >
                <span className="text-[9px] uppercase tracking-[0.16em] opacity-75 leading-none font-medium">
                  {CHIP_LABELS[c.kind]}
                </span>
                <span className="text-[14px] font-bold leading-tight mt-1">
                  {c.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
