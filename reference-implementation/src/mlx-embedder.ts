/**
 * MLX Embedder - Client for MLX embedding server
 * Replaces OllamaEmbedder with native MLX on Apple Silicon
 */

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  isAvailable(): Promise<boolean>;
  getDimensions(): number;
}

export interface MLXEmbedderConfig {
  baseUrl: string;
  dimensions: number;
}

interface EmbedResponse {
  embeddings: number[][];
  dimensions: number;
}

interface HealthResponse {
  status: string;
  model: string;
  dimensions: number;
}

export class MLXEmbedder implements Embedder {
  private baseUrl: string;
  private dimensions: number;

  constructor(config: MLXEmbedderConfig) {
    this.baseUrl = config.baseUrl;
    this.dimensions = config.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const response = await fetch(`${this.baseUrl}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`MLX server error: ${response.status} - ${error}`);
      }

      const data = await response.json() as EmbedResponse;
      return data.embeddings;
    } catch (error) {
      if (error instanceof Error && error.message.includes('fetch failed')) {
        throw new Error(`MLX server not available at ${this.baseUrl}. Is it running?`);
      }
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json() as HealthResponse;
        return data.status === 'ok';
      }
      return false;
    } catch {
      return false;
    }
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
