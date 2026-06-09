/* Retrieval eval runner.
 *
 * Usage: from web/:
 *   npx tsx scripts/eval.ts            # synthetic eval over 30 random segments
 *   npx tsx scripts/eval.ts --n 100    # custom sample size
 *   npx tsx scripts/eval.ts --golden   # use eval/golden_queries.yaml only
 *
 * Writes a JSON report to web/public/eval-latest.json which the /eval page
 * renders. Re-running overwrites the file.
 */
import { writeFile, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import OpenAI from "openai";
import { parse as parseYaml } from "yaml";

// Load env from .env.local before importing modules that read process.env at import time.
const __dirname_eval = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname_eval, "..", ".env.local");
if (existsSync(ENV_PATH)) {
  // Node 20.6+ native loader.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).loadEnvFile?.(ENV_PATH);
}

import { sql } from "../lib/db";
import { OPENAI_API_KEY } from "../lib/env";
import { searchMoments } from "../lib/search";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..");
const REPORT_PATH = resolve(HERE, "..", "public", "eval-latest.json");
const GOLDEN_PATH = resolve(PROJECT_ROOT, "eval", "golden_queries.yaml");
const PARAPHRASE_MODEL = "gpt-4o-mini";

interface ExpectedHit {
  video_id: string;
  t_min?: number;
  t_max?: number;
}
interface GoldenQuery {
  query: string;
  expected: ExpectedHit[];
  notes?: string;
}
interface GoldenFile {
  queries: GoldenQuery[];
}

interface QueryEvalResult {
  query: string;
  notes?: string;
  source?: "golden" | "synthetic";
  expectedVideo: string;
  expectedTRange?: [number, number];
  rank: number | null; // 1-indexed rank of the first hit; null if not found
  topHits: Array<{ videoId: string; startS: number; score: number }>;
}

interface EvalReport {
  ranAt: string;
  mode: "golden" | "synthetic" | "mixed";
  k: number;
  total: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  details: QueryEvalResult[];
}

function parseArgs(argv: string[]) {
  const opts = { n: 30, goldenOnly: false, k: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--n") opts.n = Number(argv[++i] ?? opts.n);
    else if (a === "--k") opts.k = Number(argv[++i] ?? opts.k);
    else if (a === "--golden") opts.goldenOnly = true;
  }
  return opts;
}

async function loadGolden(): Promise<GoldenQuery[]> {
  try {
    const raw = await readFile(GOLDEN_PATH, "utf8");
    const parsed = parseYaml(raw) as GoldenFile;
    return parsed?.queries ?? [];
  } catch {
    return [];
  }
}

async function paraphrase(text: string): Promise<string> {
  const client = new OpenAI({ apiKey: OPENAI_API_KEY() });
  const resp = await client.chat.completions.create({
    model: PARAPHRASE_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "Rewrite the speaker's words as a short natural-language search query (8-20 words) that an editor might type to find this moment. Keep meaning; drop filler. Output only the query.",
      },
      { role: "user", content: text },
    ],
  });
  return (resp.choices[0]?.message?.content ?? "").trim().replace(/^"|"$/g, "");
}

function isHit(
  expected: ExpectedHit,
  hit: { videoId: string; aStartS: number; aEndS: number },
): boolean {
  if (hit.videoId !== expected.video_id) return false;
  if (expected.t_min === undefined && expected.t_max === undefined) return true;
  const lo = expected.t_min ?? 0;
  const hi = expected.t_max ?? Number.MAX_SAFE_INTEGER;
  // overlap test on the answer window
  return hit.aEndS >= lo && hit.aStartS <= hi;
}

async function evalQuery(
  q: GoldenQuery,
  source: "golden" | "synthetic",
  k: number,
): Promise<QueryEvalResult> {
  const hits = await searchMoments({ query: q.query, k });
  let rank: number | null = null;
  for (let i = 0; i < hits.length; i++) {
    if (q.expected.some((e) => isHit(e, hits[i]))) {
      rank = i + 1;
      break;
    }
  }
  const ex = q.expected[0];
  return {
    query: q.query,
    notes: q.notes,
    source,
    expectedVideo: ex?.video_id ?? "",
    expectedTRange:
      ex && (ex.t_min !== undefined || ex.t_max !== undefined)
        ? [ex.t_min ?? 0, ex.t_max ?? Number.MAX_SAFE_INTEGER]
        : undefined,
    rank,
    topHits: hits.slice(0, 5).map((h) => ({
      videoId: h.videoId,
      startS: h.aStartS,
      score: h.score,
    })),
  };
}

async function buildSyntheticQueries(n: number): Promise<GoldenQuery[]> {
  // Sample answer text from moments (the indexed unit). Skip very short
  // answers — they don't contain enough signal to paraphrase usefully.
  const rows = (await sql()`
    select id, video_id, a_start_s as start_s, a_end_s as end_s, a_text as text
    from moments
    where char_length(a_text) > 200
    order by random()
    limit ${n}
  `) as Array<{ video_id: string; start_s: string; end_s: string; text: string }>;

  const out: GoldenQuery[] = [];
  for (const r of rows) {
    const query = await paraphrase(r.text);
    if (!query) continue;
    out.push({
      query,
      expected: [
        {
          video_id: r.video_id,
          t_min: Math.max(0, Number(r.start_s) - 15),
          t_max: Number(r.end_s) + 15,
        },
      ],
      notes: "synthetic — paraphrased from source answer",
    });
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const golden = await loadGolden();

  let mode: EvalReport["mode"];
  let queries: Array<{ q: GoldenQuery; source: "golden" | "synthetic" }>;

  if (opts.goldenOnly || (golden.length > 0 && opts.n === 0)) {
    mode = "golden";
    queries = golden.map((q) => ({ q, source: "golden" as const }));
  } else if (golden.length === 0) {
    mode = "synthetic";
    console.log(`Building ${opts.n} synthetic queries via paraphrase...`);
    const synth = await buildSyntheticQueries(opts.n);
    queries = synth.map((q) => ({ q, source: "synthetic" as const }));
  } else {
    mode = "mixed";
    console.log(`Building ${opts.n} synthetic queries via paraphrase...`);
    const synth = await buildSyntheticQueries(opts.n);
    queries = [
      ...golden.map((q) => ({ q, source: "golden" as const })),
      ...synth.map((q) => ({ q, source: "synthetic" as const })),
    ];
  }

  if (queries.length === 0) {
    console.log("No queries — add entries to eval/golden_queries.yaml or pass --n N.");
    process.exit(0);
  }

  const details: QueryEvalResult[] = [];
  for (const { q, source } of queries) {
    const result = await evalQuery(q, source, opts.k);
    details.push(result);
    console.log(
      `  ${source}  rank=${result.rank ?? "miss"}  ${result.query.slice(0, 70)}`,
    );
  }

  const total = details.length;
  const recallAt5 = details.filter((d) => d.rank !== null && d.rank <= 5).length / total;
  const recallAt10 = details.filter((d) => d.rank !== null && d.rank <= 10).length / total;
  const mrr =
    details.reduce((acc, d) => acc + (d.rank ? 1 / d.rank : 0), 0) / total;

  const report: EvalReport = {
    ranAt: new Date().toISOString(),
    mode,
    k: opts.k,
    total,
    recallAt5,
    recallAt10,
    mrr,
    details,
  };

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log("\n=== Summary ===");
  console.log(`mode: ${mode}`);
  console.log(`total: ${total}`);
  console.log(`recall@5:  ${(recallAt5 * 100).toFixed(1)}%`);
  console.log(`recall@10: ${(recallAt10 * 100).toFixed(1)}%`);
  console.log(`MRR:       ${mrr.toFixed(3)}`);
  console.log(`Wrote ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
