import OpenAI from "openai";
import { HYDE_MODEL, OPENAI_API_KEY } from "./env";

let _client: OpenAI | null = null;
function client() {
  if (!_client) _client = new OpenAI({ apiKey: OPENAI_API_KEY() });
  return _client;
}

const SYSTEM = `You rewrite a short user search query into a 1-2 sentence hypothetical answer
written in the conversational, podcast-like speech of a business interview. The corpus
is long-form video where founders and operators discuss companies, sales, pricing,
hiring, partnerships, and scaling. Match the vocabulary and rhythm of natural speech
(contractions, mid-thought connectors, concrete numbers/examples when relevant). Do
not include preamble, quotes, or markdown. Output the answer only.`;

export async function hypotheticalAnswer(query: string): Promise<string> {
  const resp = await client().chat.completions.create({
    model: HYDE_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: query },
    ],
    temperature: 0.2,
    max_tokens: 160,
  });
  const text = resp.choices[0]?.message?.content?.trim() ?? "";
  return text || query;
}
