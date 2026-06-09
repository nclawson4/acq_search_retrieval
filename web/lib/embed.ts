import OpenAI from "openai";
import { OPENAI_API_KEY, TEXT_EMBED_MODEL } from "./env";

let _client: OpenAI | null = null;

function client() {
  if (!_client) _client = new OpenAI({ apiKey: OPENAI_API_KEY() });
  return _client;
}

export async function embedQuery(text: string): Promise<number[]> {
  const resp = await client().embeddings.create({
    model: TEXT_EMBED_MODEL,
    input: text,
  });
  return resp.data[0].embedding as number[];
}
