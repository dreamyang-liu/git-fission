/**
 * Commit analysis helper functions
 */

export function analyzeFileRelatedness(files: string[]): { score: number; issues: string[] } {
  if (files.length <= 1) return { score: 1, issues: [] };

  const dirs = new Set(files.map(f => f.split('/').slice(0, -1).join('/') || '.'));
  const exts = new Set(files.map(f => f.split('.').pop() || ''));

  const issues: string[] = [];
  if (dirs.size > 3) issues.push(`Changes span ${dirs.size} directories`);

  const dirScore = Math.max(0, 1 - (dirs.size - 1) * 0.15);
  const extScore = Math.max(0, 1 - (exts.size - 1) * 0.1);

  return { score: dirScore * 0.7 + extScore * 0.3, issues };
}

export function analyzeMessage(message: string): { score: number; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 0.5;

  if (message.length < 10) { issues.push('Commit message too short'); score -= 0.3; }
  else if (message.length >= 20) score += 0.1;

  const goodPrefixes = [
    /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?:/i,
    /^(Add|Fix|Update|Remove|Refactor|Implement|Improve|Clean)/i,
  ];
  if (goodPrefixes.some(p => p.test(message))) score += 0.2;
  else suggestions.push('Consider using conventional commit format');

  const badPatterns = [/^(WIP|wip)/i, /^(fix|update|change)$/i, /^.{1,5}$/];
  if (badPatterns.some(p => p.test(message))) { issues.push('Commit message is vague or WIP'); score -= 0.2; }

  return { score: Math.max(0, Math.min(1, score)), issues, suggestions };
}
