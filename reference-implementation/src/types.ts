export type MemoryType = 'decision' | 'preference' | 'conversation' | 'fact' | 'pattern';

export type MemorySource =
  | 'manual'
  | 'auto:session'
  | 'auto:commit'
  | 'auto:pattern'
  | 'auto:bootstrap'
  | 'auto:ingest'
  | 'auto:response'
  | 'auto:precompact';

export interface Memory {
  id: number;
  content: string;
  type: MemoryType;
  category?: string;
  project?: string;
  reasoning?: string;
  source: MemorySource;
  importance: number;
  confidence: number;
  createdAt: number;
  lastAccessed?: number;
  accessCount: number;
  expiresAt?: number;
  supersedes?: number;
  isObsolete: boolean;
  tags: string[];
}

export interface MemoryInput {
  content: string;
  type?: MemoryType;
  category?: string;
  project?: string;
  reasoning?: string;
  source?: MemorySource;
  importance?: number;
  confidence?: number;
  tags?: string[];
  expiresAt?: number;
  supersedes?: number;
  skipDedup?: boolean;
}

export interface RecallResult {
  memory: Memory;
  distance: number;
  score: number;
  source: string | null;  // project name or null for global
}

export interface RecallOptions {
  limit?: number;
  type?: MemoryType;
  minImportance?: number;
  includeObsolete?: boolean;
}

export interface Chunk {
  content: string;
  index: number;
  total: number;
}

export interface ProjectInfo {
  paths: string[];
  description: string;
  createdAt: number;
}

export interface ProjectRegistry {
  projects: Record<string, ProjectInfo>;
}

export interface Config {
  embedding: {
    provider: 'mlx';
    model: string;
    dimensions: number;
    baseUrl: string;
  };
  chunking: {
    maxTokens: number;
    overlapTokens: number;
    minChunkSize: number;
  };
  recall: {
    projectResults: number;
    globalResults: number;
    globalTypesInProject: MemoryType[];
    distanceThreshold: number;
    boostRecency: boolean;
    recencyHalfLifeDays: number;
  };
  capture: {
    autoSession: boolean;
    autoCommit: boolean;
    commitPatterns: string[];
    minImportance: number;
  };
  sensitive: {
    patterns: string[];
  };
  dedup: {
    enabled: boolean;
    similarityThreshold: number;
    preferLonger: boolean;
  };
  gc: {
    maxAgeUnusedDays: number;
    minConfidence: number;
  };
}
