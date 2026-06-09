import { QdrantClient } from "@qdrant/js-client-rest";
import { QDRANT_API_KEY, QDRANT_URL } from "./env";

let _client: QdrantClient | null = null;

export function qdrant() {
  if (!_client) {
    _client = new QdrantClient({ url: QDRANT_URL(), apiKey: QDRANT_API_KEY() });
  }
  return _client;
}
