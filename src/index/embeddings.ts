import { client } from '../api/github-models.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 64;

export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const input = texts.slice(i, i + BATCH_SIZE);
    try {
      const response = await client().embeddings.create({
        model: EMBEDDING_MODEL,
        input,
      });
      vectors.push(...response.data.map((item) => item.embedding));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Embedding request failed: ${message}`);
    }
  }

  return vectors;
}
