/* Run the 5 hero animation queries against the real search pipeline and
 * print the top result's videoId + title. Pipe the output to find each
 * query's matching video so we can wire the polished/YouTube thumbnail.
 *
 * Usage from web/:  npx tsx scripts/hero_queries.ts
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname_hero = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname_hero, "..", ".env.local");
if (existsSync(ENV_PATH)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).loadEnvFile?.(ENV_PATH);
}

import { searchSessions } from "../lib/sessions";

const QUERIES = [
  "Young male restaurant owners",
  "Med spa owners doing under $5M",
  "Ecommerce founders doing over $10M",
  "Business owners over $1M dealing with churn",
  "Business owners over $50M",
];

async function main() {
  for (const q of QUERIES) {
    try {
      const r = await searchSessions({
        query: q,
        filters: { industry: null, revenueBands: [], gender: null, topics: [] },
        k: 5,
      });
      const top = r.hits[0];
      console.log(`\n=== ${q} ===`);
      console.log(`  extracted: ${JSON.stringify(r.extracted)}`);
      if (!top) {
        console.log("  (no results)");
        continue;
      }
      console.log(`  videoId: ${top.videoId}`);
      console.log(`  title:   ${top.videoTitle}`);
      console.log(`  industry: ${top.industry}  revenue: ${top.revenueBand}  gender: ${top.attendeeGender}`);
      console.log(`  topics:  ${(top.topics ?? []).join(", ")}`);
      console.log(`  summary: ${top.conversationSummary.slice(0, 120)}`);
    } catch (err) {
      console.log(`\n=== ${q} ===`);
      console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
