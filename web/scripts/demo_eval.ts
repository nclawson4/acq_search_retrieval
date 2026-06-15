/* Demo-query eval runner.
 *
 * Runs the 10 hand-picked demo queries (5 cycling examples + 5 hero animation
 * queries) through the production search pipeline and captures everything a
 * skeptical reader needs to verify the system works: filter extraction,
 * candidate count, top-3 judge scores, latency.
 *
 * Output: web/public/demo-eval-latest.json, read by the Golden Set section
 * on the home page.
 *
 * Usage from web/:
 *   npx tsx scripts/demo_eval.ts
 */
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname_eval = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname_eval, "..", ".env.local");
if (existsSync(ENV_PATH)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).loadEnvFile?.(ENV_PATH);
}

import { searchSessions } from "../lib/sessions";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(HERE, "..", "public", "demo-eval-latest.json");

type Source = "cycling" | "hero";

interface DemoQuery {
  query: string;
  source: Source;
}

// Mirrors web/components/CyclingExample.tsx EXAMPLES. Keep in sync.
const CYCLING: string[] = [
  "female founders building a service business",
  "home services hiring their first sales team",
  "real estate brokers",
  "agency owners around $1-5M with churn problems",
];

// Mirrors web/components/HeroAnimation.tsx QUERIES.naturalQuery. Keep in sync.
const HERO: string[] = [
  "Young male restaurant owners",
  "Med spa owners doing under $5M",
  "Ecommerce founders doing over $10M",
  "Business owners over $1M dealing with churn",
  "Business owners over $50M",
];

const QUERIES: DemoQuery[] = [
  ...CYCLING.map((q) => ({ query: q, source: "cycling" as const })),
  ...HERO.map((q) => ({ query: q, source: "hero" as const })),
];

interface TopHit {
  videoTitle: string;
  videoId: string;
  startS: number;
  durationS: number;
  industry: string | null;
  secondaryIndustries: string[];
  revenueBand: string | null;
  attendeeGender: string | null;
  topics: string[];
  judgeScore: number;
  semanticScore: number;
  reason: string;
}

interface PerQueryResult {
  query: string;
  source: Source;
  extracted: {
    industry: string | null;
    revenueBands: string[];
    gender: string | null;
    topics: string[];
    residualText: string;
  };
  hitsCount: number;
  topHits: TopHit[];
  latencyMs: number;
  meanTop3JudgeScore: number;
  passedRelevanceFloor: boolean; // any hit returned (the pipeline drops <0.5)
}

interface Report {
  ranAt: string;
  total: number;
  passRate: number; // share that returned ≥1 hit above 0.5 judge floor
  meanLatencyMs: number;
  medianLatencyMs: number;
  meanTop1JudgeScore: number;
  meanHits: number;
  details: PerQueryResult[];
}

async function runOne(dq: DemoQuery): Promise<PerQueryResult> {
  const t0 = Date.now();
  const r = await searchSessions({ query: dq.query, k: 10 });
  const latencyMs = Date.now() - t0;
  const top = r.hits.slice(0, 3);
  const meanTop3 =
    top.length > 0
      ? top.reduce((acc, h) => acc + h.judgeScore, 0) / top.length
      : 0;
  return {
    query: dq.query,
    source: dq.source,
    extracted: {
      industry: r.extracted.industry,
      revenueBands: r.extracted.revenueBands,
      gender: r.extracted.gender,
      topics: r.extracted.topics,
      residualText: r.extracted.residualText,
    },
    hitsCount: r.hits.length,
    topHits: top.map((h) => ({
      videoTitle: h.videoTitle,
      videoId: h.videoId,
      startS: h.startS,
      durationS: Math.max(0, Math.round(h.endS - h.startS)),
      industry: h.industry,
      secondaryIndustries: h.secondaryIndustries ?? [],
      revenueBand: h.revenueBand,
      attendeeGender: h.attendeeGender,
      topics: h.topics.slice(0, 4),
      judgeScore: h.judgeScore,
      semanticScore: h.semanticScore,
      reason: h.reason,
    })),
    latencyMs,
    meanTop3JudgeScore: meanTop3,
    passedRelevanceFloor: r.hits.length > 0,
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

async function main() {
  console.log(`Running ${QUERIES.length} demo queries through searchSessions…`);
  const details: PerQueryResult[] = [];
  for (const dq of QUERIES) {
    const result = await runOne(dq);
    details.push(result);
    const top = result.topHits[0];
    console.log(
      `  [${result.source}] ${result.latencyMs.toString().padStart(5)}ms  hits=${result.hitsCount}  top=${top ? `${top.judgeScore.toFixed(2)} "${top.videoTitle.slice(0, 50)}"` : "n/a"}  q="${result.query.slice(0, 60)}"`,
    );
  }

  const latencies = details.map((d) => d.latencyMs);
  const meanLat = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const top1 = details
    .map((d) => d.topHits[0]?.judgeScore ?? 0)
    .reduce((a, b) => a + b, 0) / details.length;
  const meanHits = details.reduce((a, d) => a + d.hitsCount, 0) / details.length;
  const passRate =
    details.filter((d) => d.passedRelevanceFloor).length / details.length;

  const report: Report = {
    ranAt: new Date().toISOString(),
    total: details.length,
    passRate,
    meanLatencyMs: meanLat,
    medianLatencyMs: median(latencies),
    meanTop1JudgeScore: top1,
    meanHits,
    details,
  };

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log("\n=== Demo eval summary ===");
  console.log(`total queries:      ${report.total}`);
  console.log(`pass rate (≥1 hit): ${(passRate * 100).toFixed(0)}%`);
  console.log(`mean top-1 judge:   ${top1.toFixed(2)}`);
  console.log(`mean latency:       ${meanLat.toFixed(0)}ms`);
  console.log(`median latency:     ${report.medianLatencyMs.toFixed(0)}ms`);
  console.log(`mean hits returned: ${meanHits.toFixed(1)}`);
  console.log(`wrote ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
