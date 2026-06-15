"use client";

import { useState } from "react";

const SYSTEM_PER_QUERY_USD = 0.0018;
const FIXED_MONTHLY_INFRA_USD = 25;

const CLIPS_MIN = 10;
const CLIPS_MAX = 1000;
const MINUTES_MIN = 5;
const MINUTES_MAX = 90;
const RATE_MIN = 30;
const RATE_MAX = 150;

function fmtUSD(n: number): string {
  if (Math.abs(n) < 1) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

interface ControlProps {
  label: string;
  detail: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (n: number) => void;
}

function Control({
  label,
  detail,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: ControlProps) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {label}
          </label>
          <div className="text-[11px] text-zinc-500 mt-0.5">{detail}</div>
        </div>
        <div className="flex items-baseline gap-2 shrink-0">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
            className="w-20 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-right tabular-nums text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
          />
          <span className="text-xs text-zinc-500 w-12">{suffix}</span>
        </div>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="mt-2 w-full accent-zinc-900 dark:accent-zinc-100"
      />
    </div>
  );
}

export default function SavingsCalculator() {
  const [clips, setClips] = useState(200);
  const [minutes, setMinutes] = useState(30);
  const [rate, setRate] = useState(60);

  const manualHours = (clips * minutes) / 60;
  const manualUSD = manualHours * rate;
  const systemUSD = clips * SYSTEM_PER_QUERY_USD + FIXED_MONTHLY_INFRA_USD;
  const savings = manualUSD - systemUSD;
  const multiple = systemUSD > 0 ? manualUSD / systemUSD : 0;

  return (
    <div className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Editor time saved, try your own numbers
        </h3>
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">
          Drag the sliders
        </span>
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 lg:gap-10 items-start">
        {/* Inputs */}
        <div className="space-y-5">
          <Control
            label="Clips per month"
            detail="How many separate clips your team finds and pulls each month"
            value={clips}
            min={CLIPS_MIN}
            max={CLIPS_MAX}
            step={10}
            suffix="clips"
            onChange={setClips}
          />
          <Control
            label="Scrub time per clip"
            detail="Minutes an editor spends finding one clip manually (README cites 30–60)"
            value={minutes}
            min={MINUTES_MIN}
            max={MINUTES_MAX}
            step={1}
            suffix="min"
            onChange={setMinutes}
          />
          <Control
            label="Editor rate"
            detail="Loaded hourly rate for a senior editor"
            value={rate}
            min={RATE_MIN}
            max={RATE_MAX}
            step={5}
            suffix="$/hr"
            onChange={setRate}
          />
        </div>

        {/* Output */}
        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 p-5 lg:min-w-[280px]">
          <Row label="Manual cost" value={fmtUSD(manualUSD)} />
          <Row label="With system" value={fmtUSD(systemUSD)} />
          <div className="my-3 border-t border-zinc-200 dark:border-zinc-800" />
          <Row
            label="Saved per month"
            value={fmtUSD(savings)}
            big
            emphasis
          />
          <Row label="Cost multiple" value={`${multiple.toFixed(0)}×`} sub />
          <div className="mt-3 text-[11px] text-zinc-500">
            {manualHours.toFixed(0)} editor hours replaced
          </div>
        </div>
      </div>

      <p className="mt-5 text-[11px] text-zinc-500 leading-relaxed max-w-3xl">
        Manual cost is <em>clips × minutes-per-clip × editor rate</em>. System
        cost is <em>clips × $0.0018</em> in inference plus a flat ~$25/mo for
        the managed infra (Vercel, Neon, Qdrant Cloud, Upstash) at the included
        tiers.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  big,
  emphasis,
  sub,
}: {
  label: string;
  value: string;
  big?: boolean;
  emphasis?: boolean;
  sub?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span
        className={`${sub ? "text-xs" : "text-sm"} text-zinc-600 dark:text-zinc-400`}
      >
        {label}
      </span>
      <span
        className={`tabular-nums ${big ? "text-2xl font-semibold" : sub ? "text-sm" : "text-base font-medium"} ${emphasis ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-900 dark:text-zinc-100"}`}
      >
        {value}
      </span>
    </div>
  );
}
