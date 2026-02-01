/**
 * Git helper functions
 */

import { spawnSync } from 'child_process';
import { c } from './config.js';
import type { CommitInfo } from './types.js';

export function runGit(args: string[]): { ok: boolean; output: string } {
  const result = spawnSync('git', args, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
  });

  if (result.status === 0) {
    return { ok: true, output: (result.stdout || '').trim() };
  } else {
    const errorMsg = result.stderr || result.error?.message || 'Unknown error';
    return { ok: false, output: errorMsg.toString().trim() };
  }
}

export function getUnpushedCommits(n?: number): string[] {
  const { ok: branchOk, output: branch } = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branchOk) return [];

  let tracking = '';
  const { ok: trackOk, output: trackBranch } = runGit(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]);

  if (trackOk) {
    tracking = trackBranch;
  } else {
    for (const def of ['origin/main', 'origin/master']) {
      const { ok } = runGit(['rev-parse', def]);
      if (ok) { tracking = def; break; }
    }
    if (!tracking) return [];
  }

  const cmd = ['rev-list', `${tracking}..HEAD`];
  if (n) cmd.push('-n', String(n));

  const { ok, output } = runGit(cmd);
  if (!ok || !output) return [];
  return output.split('\n').filter(Boolean);
}

export function getCommitInfo(hash: string, includeDiff: boolean | 'full' = false): CommitInfo | null {
  const { ok, output } = runGit(['show', hash, '--format=%H%n%h%n%s%n%an', '--stat', '--stat-width=1000']);
  if (!ok) return null;
  const lines = output.split('\n');
  if (lines.length < 4) return null;

  const [fullHash, shortHash, message, author] = lines;
  const files: string[] = [];
  let insertions = 0, deletions = 0;

  for (const line of lines.slice(5)) {
    if (!line.trim()) continue;
    const fileMatch = line.match(/^\s*(.+?)\s*\|\s*(\d+)/);
    if (fileMatch) files.push(fileMatch[1].trim());
    const insMatch = line.match(/(\d+) insertion/);
    if (insMatch) insertions = parseInt(insMatch[1]);
    const delMatch = line.match(/(\d+) deletion/);
    if (delMatch) deletions = parseInt(delMatch[1]);
  }

  let diff = '';
  if (includeDiff) {
    const { ok: diffOk, output: diffOut } = runGit(['show', hash, '--format=', '-p']);
    if (diffOk && diffOut) {
      const maxDiff = includeDiff === 'full' ? 200000 : 8000;
      if (includeDiff === 'full' && diffOut.length > maxDiff) {
        console.error(`  ${c.red}Error: Diff is too large (${Math.round(diffOut.length / 1024)}KB > 200KB limit)${c.reset}`);
        console.error(`  ${c.yellow}Please split this commit manually into smaller chunks first.${c.reset}`);
        console.error(`  ${c.dim}Tip: Use 'git reset HEAD~1' to unstage, then create smaller commits.${c.reset}`);
        return null;
      }
      diff = diffOut.length > maxDiff ? diffOut.slice(0, maxDiff) + '\n... (truncated)' : diffOut;
    } else {
      console.error(`  ${c.yellow}Warning: Failed to get diff (ok=${diffOk})${c.reset}`);
      if (diffOut) console.error(`  ${c.dim}Error: ${diffOut}${c.reset}`);
    }
  }

  return { hash: fullHash, shortHash, message, author, filesChanged: files.length, insertions, deletions, files, diff };
}
