/* Filter-extraction + filter-fidelity eval.
 *
 * Two metrics that map to the product goal ("given an editor's natural-
 * language description, surface the right sessions"):
 *
 *   1. Filter extraction accuracy. For ~25 hand-labeled queries, did the
 *      LLM extract the same industry / revenue / gender / topics a human
 *      reviewer would?
 *
 *   2. Filter fidelity in returned sessions. For the 10 demo queries (which
 *      already ran through searchSessions and are persisted in
 *      demo-eval-latest.json), do the returned sessions actually respect
 *      the extracted intent? Hard filters (revenue, gender) should be
 *      100%. Soft signals (industry, topics) are softer. The system uses
 *      them as ranking guidance only, so 100% is not the bar.
 *
 * Usage from web/:
 *   npx tsx scripts/filter_eval.ts
 *
 * Writes web/public/filter-eval-latest.json which the Golden Set section
 * renders.
 */
import { writeFile, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const __dirname_eval = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname_eval, "..", ".env.local");
if (existsSync(ENV_PATH)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).loadEnvFile?.(ENV_PATH);
}

import { extractFilters } from "../lib/extract";
import type {
  Gender,
  Industry,
  RevenueBand,
  Topic,
} from "../lib/taxonomy";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..");
const TEST_SET_PATH = resolve(PROJECT_ROOT, "eval", "extraction_test_set.yaml");
const DEMO_PATH = resolve(HERE, "..", "public", "demo-eval-latest.json");
const REPORT_PATH = resolve(HERE, "..", "public", "filter-eval-latest.json");

interface TestCase {
  query: string;
  industry: Industry | null;
  revenue_bands: RevenueBand[];
  gender: Gender | null;
  topics: Topic[];
}

interface TestFile {
  tests: TestCase[];
}

interface ExtractionRow {
  query: string;
  expected: {
    industry: Industry | null;
    revenueBands: RevenueBand[];
    gender: Gender | null;
    topics: Topic[];
  };
  actual: {
    industry: Industry | null;
    revenueBands: RevenueBand[];
    gender: Gender | null;
    topics: Topic[];
  };
  industryCorrect: boolean;
  revenueBandsCorrect: boolean;
  genderCorrect: boolean;
  topicsPrecision: number;
  topicsRecall: number;
}

function setEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

function setPR<T>(predicted: T[], expected: T[]): { precision: number; recall: number } {
  if (predicted.length === 0 && expected.length === 0) {
    return { precision: 1, recall: 1 };
  }
  const sp = new Set(predicted);
  const se = new Set(expected);
  let tp = 0;
  for (const x of sp) if (se.has(x)) tp++;
  const precision = predicted.length === 0 ? 1 : tp / predicted.length;
  const recall = expected.length === 0 ? 1 : tp / expected.length;
  return { precision, recall };
}

async function loadTests(): Promise<TestCase[]> {
  const raw = await readFile(TEST_SET_PATH, "utf8");
  const parsed = parseYaml(raw) as TestFile;
  return parsed.tests ?? [];
}

async function runExtractionEval(tests: TestCase[]): Promise<{
  rows: ExtractionRow[];
  summary: {
    total: number;
    industryAccuracy: number;
    revenueBandsAccuracy: number;
    genderAccuracy: number;
    topicsPrecision: number;
    topicsRecall: number;
    topicsF1: number;
    allFieldsCorrect: number;
  };
}> {
  const rows: ExtractionRow[] = [];
  for (const tc of tests) {
    const { filters } = await extractFilters(tc.query);
    const topicsPR = setPR(filters.topics, tc.topics);
    const row: ExtractionRow = {
      query: tc.query,
      expected: {
        industry: tc.industry,
        revenueBands: tc.revenue_bands,
        gender: tc.gender,
        topics: tc.topics,
      },
      actual: {
        industry: filters.industry,
        revenueBands: filters.revenueBands,
        gender: filters.gender,
        topics: filters.topics,
      },
      industryCorrect: filters.industry === tc.industry,
      revenueBandsCorrect: setEqual(filters.revenueBands, tc.revenue_bands),
      genderCorrect: filters.gender === tc.gender,
      topicsPrecision: topicsPR.precision,
      topicsRecall: topicsPR.recall,
    };
    rows.push(row);
    const mark = (b: boolean) => (b ? "OK" : "  ");
    console.log(
      `  [${mark(row.industryCorrect)}|${mark(row.revenueBandsCorrect)}|${mark(row.genderCorrect)}|${row.topicsPrecision.toFixed(2)}/${row.topicsRecall.toFixed(2)}]  ${tc.query}`,
    );
  }
  const total = rows.length;
  const industryAccuracy = rows.filter((r) => r.industryCorrect).length / total;
  const revenueBandsAccuracy =
    rows.filter((r) => r.revenueBandsCorrect).length / total;
  const genderAccuracy = rows.filter((r) => r.genderCorrect).length / total;
  const topicsPrecision = rows.reduce((a, r) => a + r.topicsPrecision, 0) / total;
  const topicsRecall = rows.reduce((a, r) => a + r.topicsRecall, 0) / total;
  const topicsF1 =
    topicsPrecision + topicsRecall === 0
      ? 0
      : (2 * topicsPrecision * topicsRecall) / (topicsPrecision + topicsRecall);
  const allFieldsCorrect = rows.filter(
    (r) =>
      r.industryCorrect &&
      r.revenueBandsCorrect &&
      r.genderCorrect &&
      r.topicsPrecision === 1 &&
      r.topicsRecall === 1,
  ).length;
  return {
    rows,
    summary: {
      total,
      industryAccuracy,
      revenueBandsAccuracy,
      genderAccuracy,
      topicsPrecision,
      topicsRecall,
      topicsF1,
      allFieldsCorrect,
    },
  };
}

// ---------- Fidelity: do returned sessions respect the extracted intent? ----

interface DemoTopHit {
  videoTitle: string;
  industry: string | null;
  secondaryIndustries?: string[];
  revenueBand: string | null;
  attendeeGender: string | null;
  topics: string[];
}

interface DemoDetail {
  query: string;
  source: string;
  extracted: {
    industry: string | null;
    revenueBands: string[];
    gender: string | null;
    topics: string[];
  };
  topHits: DemoTopHit[];
  hitsCount: number;
}

interface DemoReport {
  details: DemoDetail[];
}

interface FidelitySummary {
  // counts denote (hits-with-applicable-filter, hits-that-respect-it)
  revenue: { applicable: number; matched: number; rate: number };
  gender: { applicable: number; matched: number; rate: number };
  industry: { applicable: number; matched: number; rate: number };
  topics: { applicable: number; matched: number; rate: number };
  totalHitsEvaluated: number;
}

function computeFidelity(demo: DemoReport): FidelitySummary {
  let rApp = 0, rMatch = 0;
  let gApp = 0, gMatch = 0;
  let iApp = 0, iMatch = 0;
  let tApp = 0, tMatch = 0;
  let totalHits = 0;
  for (const d of demo.details) {
    for (const h of d.topHits) {
      totalHits++;
      if (d.extracted.revenueBands.length > 0) {
        rApp++;
        if (h.revenueBand && d.extracted.revenueBands.includes(h.revenueBand)) {
          rMatch++;
        }
      }
      if (d.extracted.gender) {
        gApp++;
        if (h.attendeeGender === d.extracted.gender) gMatch++;
      }
      if (d.extracted.industry) {
        iApp++;
        // A hit "respects" the extracted industry if it's the primary tag OR
        // a verified secondary. Matches what the hard-filter path does
        // (sessions.ts builds a should-clause across both fields).
        const secondaries = h.secondaryIndustries ?? [];
        if (
          h.industry === d.extracted.industry ||
          secondaries.includes(d.extracted.industry)
        ) {
          iMatch++;
        }
      }
      if (d.extracted.topics.length > 0) {
        tApp++;
        if (h.topics.some((t) => d.extracted.topics.includes(t))) tMatch++;
      }
    }
  }
  return {
    revenue: {
      applicable: rApp,
      matched: rMatch,
      rate: rApp === 0 ? 1 : rMatch / rApp,
    },
    gender: {
      applicable: gApp,
      matched: gMatch,
      rate: gApp === 0 ? 1 : gMatch / gApp,
    },
    industry: {
      applicable: iApp,
      matched: iMatch,
      rate: iApp === 0 ? 1 : iMatch / iApp,
    },
    topics: {
      applicable: tApp,
      matched: tMatch,
      rate: tApp === 0 ? 1 : tMatch / tApp,
    },
    totalHitsEvaluated: totalHits,
  };
}

async function main() {
  console.log("Loading extraction test set…");
  const tests = await loadTests();
  console.log(`Running extraction eval on ${tests.length} cases…`);
  const extraction = await runExtractionEval(tests);

  console.log("\nLoading demo eval (for fidelity check)…");
  let fidelity: FidelitySummary | null = null;
  try {
    const raw = await readFile(DEMO_PATH, "utf8");
    const demo = JSON.parse(raw) as DemoReport;
    fidelity = computeFidelity(demo);
  } catch (err) {
    console.warn(
      `  could not load demo-eval-latest.json: ${err instanceof Error ? err.message : "unknown"}`,
    );
    console.warn("  run scripts/demo_eval.ts first to populate fidelity metrics");
  }

  const report = {
    ranAt: new Date().toISOString(),
    extraction,
    fidelity,
  };

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log("\n=== Extraction accuracy ===");
  const e = extraction.summary;
  console.log(`industry exact match:    ${(e.industryAccuracy * 100).toFixed(1)}% (${Math.round(e.industryAccuracy * e.total)}/${e.total})`);
  console.log(`revenue bands set match: ${(e.revenueBandsAccuracy * 100).toFixed(1)}% (${Math.round(e.revenueBandsAccuracy * e.total)}/${e.total})`);
  console.log(`gender exact match:      ${(e.genderAccuracy * 100).toFixed(1)}% (${Math.round(e.genderAccuracy * e.total)}/${e.total})`);
  console.log(`topics precision/recall: ${(e.topicsPrecision * 100).toFixed(1)}% / ${(e.topicsRecall * 100).toFixed(1)}% (F1 ${(e.topicsF1 * 100).toFixed(1)}%)`);
  console.log(`every field correct:     ${e.allFieldsCorrect}/${e.total} (${((e.allFieldsCorrect / e.total) * 100).toFixed(1)}%)`);

  if (fidelity) {
    console.log("\n=== Filter fidelity in returned sessions ===");
    console.log(`hits evaluated:           ${fidelity.totalHitsEvaluated}`);
    console.log(`revenue band (hard):      ${(fidelity.revenue.rate * 100).toFixed(1)}% (${fidelity.revenue.matched}/${fidelity.revenue.applicable})`);
    console.log(`gender (hard):            ${(fidelity.gender.rate * 100).toFixed(1)}% (${fidelity.gender.matched}/${fidelity.gender.applicable})`);
    console.log(`industry (soft signal):   ${(fidelity.industry.rate * 100).toFixed(1)}% (${fidelity.industry.matched}/${fidelity.industry.applicable})`);
    console.log(`topics (soft signal):     ${(fidelity.topics.rate * 100).toFixed(1)}% (${fidelity.topics.matched}/${fidelity.topics.applicable})`);
  }
  console.log(`\nWrote ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
