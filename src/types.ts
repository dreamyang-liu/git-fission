/**
 * Type definitions for git-fission
 */

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: string[];
  diff?: string;
}

export interface LLMAnalysis {
  isAtomic: boolean;
  confidence: number;
  reasoning: string;
  concerns: string[];
  splitSuggestion?: string;
}

export interface AtomicityReport {
  commit: CommitInfo;
  isAtomic: boolean;
  score: number;
  issues: string[];
  warnings: string[];
  suggestions: string[];
  llmAnalysis?: LLMAnalysis;
}

export interface SplitPlan {
  reasoning: string;
  splits: Array<{
    message: string;
    diff: string;
    description: string;
  }>;
}

export interface Thresholds {
  maxFiles: number;
  maxInsertions: number;
  maxDeletions: number;
  maxDirs: number;
  minMsgLen: number;
}
