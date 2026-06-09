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
      title: "Search moments",
      description:
        "Search ranked, timestamped moments across the indexed long-form video library. " +
        "Returns up to k results, each with the video, the start/end timestamps, the transcript text, " +
        "the URL to play at that moment, and the score.",
      inputSchema: {
        query: z.string().min(1).describe("Natural-language description of the moment."),
        k: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Maximum number of moments to return."),
        video_id: z
          .string()
          .optional()
          .describe("Optional. Restrict the search to a single video id."),
      },
    },
    async ({ query, k, video_id }) => {
      const hits = await searchMoments({ query, k, videoId: video_id });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              hits.map((h) => ({
                video_id: h.videoId,
                video_title: h.videoTitle,
                channel: h.channel,
                start_s: h.startS,
                end_s: h.endS,
                text: h.text,
                score: h.score,
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
          (select count(*) from segments s where s.video_id = v.id) as segment_count,
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
