"use client";

import { useEffect, useState } from "react";
import {
  QUERIES,
  CHIP_STYLES,
  CHIP_LABELS,
  type HeroQuery,
} from "./HeroAnimation";

// ─────────────────────────────────────────────────────────────────────────────
// Mobile-only hero animation. Single column. Sequence per query:
//   1. Before pane visible — types keyword, shows cluttered "too many" results
//   2. Slides horizontally to the After pane
//   3. After pane types natural-language query, thumbnail + callouts materialize
//   4. Slides back to Before pane with the NEXT query
// ─────────────────────────────────────────────────────────────────────────────

const PANE_W = 320;
const PANE_H = 360;
const THUMB_W = 220;
const THUMB_H = 124;
const THUMB_X = (PANE_W - THUMB_W) / 2;
const THUMB_Y = 60;

// Phase timeline per cycle (ms)
const BEFORE_TYPE_END = 1500;
const BEFORE_SEARCH_END = 1900;
const BEFORE_HOLD_END = 3700;
const SLIDE_TO_AFTER_END = 4100;
const AFTER_TYPE_END = 5500;
const AFTER_SEARCH_END = 5900;
const AFTER_REVEAL_END = 6300;
const AFTER_HOLD_END = 8200;
const SLIDE_TO_BEFORE_END = 8600;
const CYCLE = SLIDE_TO_BEFORE_END;

const FOLDERS = [
  { label: "Day_1", depth: 0 },
  { label: "Day_2", depth: 0, open: true },
  { label: "AM", depth: 1 },
  { label: "PM", depth: 1 },
  { label: "Day_3", depth: 0 },
  { label: "Day_4", depth: 0 },
  { label: "B_Roll", depth: 0 },
  { label: "Raw", depth: 0 },
];

const FILES = [
  "Day1_AM_main.mp4",
  "Day1_AM_QA_p1.mp4",
  "Day1_AM_QA_p2.mp4",
  "Day1_PM_main.mp4",
  "Day1_PM_QA.mp4",
  "Day2_AM_main.mp4",
  "Day2_AM_QA.mp4",
  "Day2_PM_main.mp4",
  "Day3_AM_main.mp4",
  "Day3_AM_QA.mp4",
  "Day3_PM_main.mp4",
  "Day4_AM_main.mp4",
];

export default function MobileHeroAnimation() {
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

  const q = QUERIES[idx];

  // Before-pane typing
  let leftTyped = "";
  if (elapsed < BEFORE_TYPE_END) {
    const p = elapsed / BEFORE_TYPE_END;
    leftTyped = q.keywordSearch.slice(
      0,
      Math.ceil(p * q.keywordSearch.length),
    );
  } else {
    leftTyped = q.keywordSearch;
  }

  const beforeSearching =
    elapsed >= BEFORE_TYPE_END && elapsed < BEFORE_SEARCH_END;
  const beforeShowResult = elapsed >= BEFORE_SEARCH_END;

  // After-pane typing — starts during the slide so the bar already has text
  // when it lands in view
  let rightTyped = "";
  if (elapsed < SLIDE_TO_AFTER_END) {
    rightTyped = "";
  } else if (elapsed < AFTER_TYPE_END) {
    const p =
      (elapsed - SLIDE_TO_AFTER_END) / (AFTER_TYPE_END - SLIDE_TO_AFTER_END);
    rightTyped = q.naturalQuery.slice(
      0,
      Math.ceil(p * q.naturalQuery.length),
    );
  } else {
    rightTyped = q.naturalQuery;
  }

  const afterSearching =
    elapsed >= AFTER_TYPE_END && elapsed < AFTER_SEARCH_END;
  const afterShowResult = elapsed >= AFTER_SEARCH_END;
  const afterShowChips = elapsed >= AFTER_REVEAL_END;

  // Cross-fade between Before and After. No overflow-hidden wrapper, no slide
  // transform → nothing creates a rectangular "card" boundary on screen.
  const showBefore = elapsed < BEFORE_HOLD_END;
  const showAfter = elapsed >= BEFORE_HOLD_END;

  return (
    <div
      className="relative w-full mx-auto select-none"
      style={{ maxWidth: `${PANE_W}px`, height: `${PANE_H}px` }}
    >
      <div
        className="absolute inset-0"
        style={{
          opacity: showBefore ? 1 : 0,
          transition: "opacity 350ms ease-out",
          pointerEvents: showBefore ? "auto" : "none",
        }}
      >
        <MobileBeforePane
          query={q}
          typed={leftTyped}
          showSearching={beforeSearching}
          showResult={beforeShowResult}
        />
      </div>
      <div
        className="absolute inset-0"
        style={{
          opacity: showAfter ? 1 : 0,
          transition: "opacity 350ms ease-out",
          pointerEvents: showAfter ? "auto" : "none",
        }}
      >
        <MobileAfterPane
          query={q}
          typed={rightTyped}
          showSearching={afterSearching}
          showResult={afterShowResult}
          showChips={afterShowChips}
        />
      </div>
    </div>
  );
}

// ─── BEFORE (mobile) ─────────────────────────────────────────────────────────

function MobileBeforePane({
  query,
  typed,
  showSearching,
  showResult,
}: {
  query: HeroQuery;
  typed: string;
  showSearching: boolean;
  showResult: boolean;
}) {
  const noMatch = query.keywordResultCount === 0;
  const matchedFiles = noMatch ? [] : FILES;
  const overflow = noMatch
    ? 0
    : Math.max(0, query.keywordResultCount - matchedFiles.length);

  return (
    <div
      className="
        relative h-full rounded-lg overflow-hidden
        border border-zinc-300 dark:border-zinc-700
        bg-white dark:bg-zinc-900
        shadow-[0_8px_24px_rgba(0,0,0,0.15)]
      "
      style={{ height: `${PANE_H}px` }}
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
          C:\Videos\Hormozi\Workshops
        </div>
        <div className="rounded border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:text-zinc-300 min-w-[78px] flex items-center gap-1">
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

      {/* Body: folder tree + file list */}
      <div className="grid grid-cols-[78px_1fr] h-[calc(100%-66px)]">
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

        <div className="p-1.5 text-[10px] overflow-hidden relative">
          {showSearching ? (
            <div className="text-zinc-400 italic px-1 py-2 flex items-center gap-1.5">
              <svg
                className="animate-spin"
                width="10"
                height="10"
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
              Searching…
            </div>
          ) : showResult ? (
            noMatch ? (
              <div className="rounded-md px-2 py-2 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/70">
                <div className="font-semibold text-[10px]">
                  ⚠ No items match
                </div>
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
                <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white dark:from-zinc-900 to-transparent pointer-events-none" />
              </>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── AFTER (mobile) ──────────────────────────────────────────────────────────

function MobileAfterPane({
  query,
  typed,
  showSearching,
  showResult,
  showChips,
}: {
  query: HeroQuery;
  typed: string;
  showSearching: boolean;
  showResult: boolean;
  showChips: boolean;
}) {
  // Free-floating layout: search bar, then thumbnail, then chips in a flex
  // row, then a CTA. NO containing card/box — every element sits on the page
  // background. No SVG connector lines (they were what implied "labels for the
  // thumb" but were also what was getting clipped on narrow mobile).
  return (
    <div
      className="relative h-full"
      style={{ height: `${PANE_H}px` }}
    >
      {/* Liquid-glass search bar */}
      <div className="absolute left-2 right-2 top-2">
        <div
          className="
            flex items-center gap-2 rounded-full px-3 py-2
            backdrop-blur-2xl
            bg-white/75 dark:bg-zinc-900/70
            border border-white/85 dark:border-zinc-700/70
            shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_4px_18px_rgba(99,102,241,0.18)]
          "
        >
          <svg
            width="13"
            height="13"
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
          <span className="text-[11px] font-medium text-zinc-900 dark:text-zinc-50 truncate leading-[1.4] py-px">
            {typed}
            <span className="animate-pulse">|</span>
          </span>
        </div>
      </div>

      {/* Thumbnail */}
      <div
        className="absolute rounded-lg overflow-hidden ring-1 ring-black/10 dark:ring-white/10 shadow-[0_8px_30px_-6px_rgba(0,0,0,0.30)] bg-zinc-200 dark:bg-zinc-800 transition-all duration-300 ease-out"
        style={{
          left: `${THUMB_X}px`,
          top: `${THUMB_Y}px`,
          width: `${THUMB_W}px`,
          height: `${THUMB_H}px`,
          opacity: showResult ? 1 : 0,
          transform: showResult ? "scale(1)" : "scale(0.94)",
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

      {/* Chips — flex row distributed across the pane width, can NEVER
          overflow because each chip is constrained to its slot's width and
          they sit between left-2 and right-2. */}
      <div
        className="absolute left-2 right-2 flex justify-between items-start gap-1.5"
        style={{ top: `${THUMB_Y + THUMB_H + 16}px` }}
      >
        {query.chips.map((c, i) => (
          <div
            key={`${c.kind}-${c.label}-${i}`}
            className="flex-1 min-w-0 transition-all duration-500 ease-out"
            style={{
              opacity: showChips ? 1 : 0,
              transform: showChips
                ? "translateY(0) scale(1)"
                : "translateY(8px) scale(0.9)",
              transitionDelay: `${i * 100}ms`,
            }}
          >
            <div
              className={`
                w-full flex flex-col items-center text-center
                rounded-md px-1.5 py-1.5
                border backdrop-blur-md
                shadow-[0_3px_10px_rgba(0,0,0,0.08)]
                ${CHIP_STYLES[c.kind]}
              `}
            >
              <span className="block text-[8px] uppercase tracking-[0.14em] opacity-70 leading-none font-medium">
                {CHIP_LABELS[c.kind]}
              </span>
              <span className="block text-[11px] font-bold leading-tight mt-1 truncate w-full">
                {c.label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Try this query button */}
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
          form.querySelectorAll("select").forEach((sel) => {
            (sel as HTMLSelectElement).value = "";
          });
          form.requestSubmit();
        }}
        className="absolute left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 px-4 py-2 text-xs font-semibold shadow-[0_6px_18px_rgba(99,102,241,0.30)] active:scale-[0.97] transition-transform"
        style={{ top: `${PANE_H - 38}px` }}
      >
        Try this query
        <svg
          width="12"
          height="12"
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
    </div>
  );
}
