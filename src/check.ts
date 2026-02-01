/**
 * Atomicity checking functions
 */

import { c, THRESHOLDS } from './config.js';
import { analyzeFileRelatedness, analyzeMessage } from './analysis.js';
import { analyzeWithLLM } from './llm.js';
import type { CommitInfo, AtomicityReport, LLMAnalysis } from './types.js';

export async function checkCommitAtomicity(
  commit: CommitInfo,
  strict: boolean,
  useLLM: boolean,
  model: string
): Promise<AtomicityReport> {
  const th = strict ? THRESHOLDS.strict : THRESHOLDS.normal;
  const issues: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const scores: number[] = [];

  // File count
  if (commit.filesChanged > th.maxFiles) {
    issues.push(`Too many files: ${commit.filesChanged} (max: ${th.maxFiles})`);
    scores.push(Math.max(0, 1 - (commit.filesChanged - th.maxFiles) / th.maxFiles));
  } else scores.push(1);

  // Line count
  const totalLines = commit.insertions + commit.deletions;
  const maxLines = th.maxInsertions + th.maxDeletions;
  if (totalLines > maxLines) {
    issues.push(`Too many lines: +${commit.insertions}/-${commit.deletions} (max: ${maxLines})`);
    scores.push(Math.max(0, 1 - (totalLines - maxLines) / maxLines));
  } else scores.push(1);

  // File relatedness
  const { score: relScore, issues: relIssues } = analyzeFileRelatedness(commit.files);
  issues.push(...relIssues);
  scores.push(relScore);

  // Message quality
  const { score: msgScore, issues: msgIssues, suggestions: msgSuggestions } = analyzeMessage(commit.message);
  issues.push(...msgIssues);
  suggestions.push(...msgSuggestions);
  scores.push(msgScore);

  // LLM analysis
  let llmAnalysis: LLMAnalysis | undefined;
  if (useLLM) {
    process.stdout.write(`  ${c.dim}Analyzing with LLM...${c.reset}`);
    llmAnalysis = await analyzeWithLLM(commit, model) || undefined;
    process.stdout.write('\r' + ' '.repeat(40) + '\r');

    if (llmAnalysis) {
      const llmScore = llmAnalysis.isAtomic ? 1 : 0.3;
      scores.push(llmScore * llmAnalysis.confidence);
      if (!llmAnalysis.isAtomic) {
        issues.push(...llmAnalysis.concerns);
        if (llmAnalysis.splitSuggestion) suggestions.push(`LLM: ${llmAnalysis.splitSuggestion}`);
      }
    }
  }

  const finalScore = (scores.reduce((a, b) => a + b, 0) / scores.length) * 100;
  const isAtomic = useLLM && llmAnalysis
    ? llmAnalysis.isAtomic && llmAnalysis.confidence > 0.6 && issues.length <= 2
    : issues.length === 0 && finalScore >= 70;

  return { commit, isAtomic, score: finalScore, issues, warnings, suggestions, llmAnalysis };
}

export function printReport(report: AtomicityReport, verbose: boolean): void {
  const { commit } = report;
  const status = report.isAtomic ? `${c.green}✓ ATOMIC${c.reset}` : `${c.red}✗ NOT ATOMIC${c.reset}`;

  console.log(`\n${c.bold}Commit ${c.blue}${commit.shortHash}${c.reset} ${status} (score: ${report.score.toFixed(0)}/100)`);
  console.log(`  ${commit.message.slice(0, 60)}${commit.message.length > 60 ? '...' : ''}`);
  console.log(`  ${commit.filesChanged} files, +${commit.insertions}/-${commit.deletions} lines`);

  if (report.llmAnalysis) {
    const conf = report.llmAnalysis.confidence;
    const confColor = conf > 0.8 ? c.green : conf > 0.5 ? c.yellow : c.red;
    console.log(`\n  ${c.cyan}🤖 LLM Analysis:${c.reset} (confidence: ${confColor}${(conf * 100).toFixed(0)}%${c.reset})`);
    console.log(`     ${report.llmAnalysis.reasoning}`);
  }

  if (report.issues.length) {
    console.log(`\n  ${c.red}Issues:${c.reset}`);
    report.issues.forEach(i => console.log(`    • ${i}`));
  }

  if (report.warnings.length) {
    console.log(`\n  ${c.yellow}Warnings:${c.reset}`);
    report.warnings.forEach(w => console.log(`    • ${w}`));
  }

  if (report.suggestions.length && (verbose || !report.isAtomic)) {
    console.log(`\n  ${c.blue}Suggestions:${c.reset}`);
    report.suggestions.forEach(s => console.log(`    ${s}`));
  }

  if (verbose && commit.files.length) {
    console.log(`\n  Files:`);
    commit.files.slice(0, 10).forEach(f => console.log(`    • ${f}`));
    if (commit.files.length > 10) console.log(`    ... and ${commit.files.length - 10} more`);
  }
}
