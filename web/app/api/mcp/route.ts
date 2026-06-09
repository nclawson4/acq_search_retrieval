import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { sql } from "@/lib/db";
import { MCP_TOKEN } from "@/lib/env";
import { searchMoments } from "@/lib/search";

export const runtime = "nodejs";

async function buildServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: "acq-search-retrieval", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "search_moments",
    {
      title: "Search Q&A moments",
      description:
        "Search clip-ready attendee-question + Alex-answer pairs across the workshop library. " +
        "Each result includes both the question and answer text with timestamps, the attendee's " +
        "business context (industry, revenue band, problem tags), audio quality, and a clip " +
        "score. Filter by speaker side, industry, revenue band, problem tags, and minimum " +
        "audio quality.",
      inputSchema: {
        query: z.string().min(1).describe("Natural-language description of the moment."),
        k: z.number().int().min(1).max(50).default(10).describe("Max results to return."),
        video_id: z.string().optional().describe("Restrict to a single video id."),
        speaker: z
          .enum(["answer", "question", "both"])
          .default("answer")
          .describe(
            "Which side of the Q&A pair to match against. 'answer' (default) ranks by " +
              "Alex's reply; 'question' ranks by the attendee's question; 'both' allows either.",
          ),
        industry: z
          .string()
          .optional()
          .describe("Filter to attendees in this industry (free-form, e.g. 'med spa')."),
        revenue_band: z
          .enum(["<$1M", "$1-5M", "$5-10M", "$10-50M", "$50M+"])
          .optional()
          .describe("Filter to attendees in this annual revenue band."),
        problems: z
          .array(z.string())
          .optional()
          .describe(
            "Filter to questions tagged with any of these problem areas (e.g. 'pricing', 'hiring').",
          ),
        min_audio_quality: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Floor for the moment's audio quality score (0-1). 0.6+ is recommended for clipping."),
      },
    },
    async ({ query, k, video_id, speaker, industry, revenue_band, problems, min_audio_quality }) => {
      const hits = await searchMoments({
        query,
        k,
        videoId: video_id,
        speaker,
        industry: industry || null,
        revenueBand: revenue_band || null,
        problems,
        minAudioQuality: min_audio_quality,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              hits.map((h) => ({
                video_id: h.videoId,
                video_title: h.videoTitle,
                channel: h.channel,
                q_start_s: h.qStartS,
                q_end_s: h.qEndS,
                q_text: h.qText,
                a_start_s: h.aStartS,
                a_end_s: h.aEndS,
                a_text: h.aText,
                matched_kind: h.matchedKind,
                score: h.score,
                industry: h.industry,
                revenue_band: h.revenueBand,
                problems: h.problems,
                audio_quality: h.audioQuality,
                clip_score: h.clipScore,
                play_url: h.playUrl,
                frame_url: h.frameUrl,
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_video",
    {
      title: "Get video metadata",
      description: "Look up metadata and indexed segment / frame counts for a single video id.",
      inputSchema: {
        video_id: z.string().describe("YouTube video id (e.g., LGbS0GOZBNE)."),
      },
    },
    async ({ video_id }) => {
      const rows = (await sql()`
        select
          v.id,
          v.url,
          v.title,
          v.channel,
          v.duration_s,
          v.ingested_at,
          v.last_indexed_at,
          (select count(*) from moments m where m.video_id = v.id) as moment_count,
          (select count(*) from frames f where f.video_id = v.id) as frame_count
        from videos v
        where v.id = ${video_id}
        limit 1
      `) as Record<string, unknown>[];
      if (rows.length === 0) {
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown video_id: ${video_id}` }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(rows[0], null, 2) }],
      };
    },
  );

  return server;
}

function checkAuth(req: Request): boolean {
  if (!MCP_TOKEN) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${MCP_TOKEN}`;
}

async function handle(req: Request): Promise<Response> {
  if (!checkAuth(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const server = await buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void transport.close();
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

export async function DELETE(req: Request) {
  return handle(req);
}
