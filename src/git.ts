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

/**
 * Get file content at a specific git ref
 */
export function getFileAtRef(ref: string, filePath: string): string | null {
  const { ok, output } = runGit(['show', `${ref}:${filePath}`]);
  return ok ? output : null;
}

/**
 * Extract file path from a patch (the 'b/' path from +++ line)
 */
export function extractFilePathFromPatch(patch: string): string | null {
  const match = patch.match(/^\+\+\+ b\/(.+)$/m);
  return match ? match[1] : null;
}

/**
 * Extract hunk line ranges from a patch
 * Returns array of { startLine, lineCount } from @@ -X,Y +A,B @@ headers
 */
export function extractHunkRanges(patch: string): Array<{ startLine: number; lineCount: number }> {
  const ranges: Array<{ startLine: number; lineCount: number }> = [];
  const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm;
  let match;
  while ((match = hunkRegex.exec(patch)) !== null) {
    ranges.push({
      startLine: parseInt(match[1]),
      lineCount: parseInt(match[2] || '1'),
    });
  }
  return ranges;
}

/**
 * Parsed hunk from a diff
 */
export interface ParsedHunk {
  id: number;           // Unique hunk ID for reference
  filePath: string;     // File being modified
  header: string;       // The @@ -X,Y +A,B @@ line
  content: string;      // The actual hunk content (without header)
  fullHunk: string;     // Complete hunk including header
  startLine: number;    // Starting line in original file
  summary: string;      // Brief summary of what this hunk does
}

/**
 * Parsed file diff with its hunks
 */
export interface ParsedFileDiff {
  filePath: string;
  fileHeader: string;   // diff --git ... index ... --- +++ lines
  hunks: ParsedHunk[];
}

/**
 * Parse a full diff into files and hunks
 */
export function parseDiffIntoHunks(diff: string): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = [];
  let hunkId = 0;

  // Split by file diffs
  const fileDiffs = diff.split(/(?=^diff --git)/m).filter(Boolean);

  for (const fileDiff of fileDiffs) {
    const lines = fileDiff.split('\n');

    // Extract file path from diff --git line
    const gitLine = lines[0];
    const fileMatch = gitLine.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (!fileMatch) continue;

    const filePath = fileMatch[2];

    // Find where hunks start (after the +++ line)
    let headerEndIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('+++')) {
        headerEndIndex = i;
        break;
      }
    }

    const fileHeader = lines.slice(0, headerEndIndex + 1).join('\n');
    const hunks: ParsedHunk[] = [];

    // Parse hunks
    let currentHunkStart = -1;
    let currentHunkHeader = '';
    let currentStartLine = 0;

    for (let i = headerEndIndex + 1; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('@@')) {
        // Save previous hunk if exists
        if (currentHunkStart !== -1) {
          const hunkContent = lines.slice(currentHunkStart + 1, i).join('\n');
          const fullHunk = currentHunkHeader + '\n' + hunkContent;
          hunks.push({
            id: hunkId++,
            filePath,
            header: currentHunkHeader,
            content: hunkContent,
            fullHunk,
            startLine: currentStartLine,
            summary: generateHunkSummary(hunkContent),
          });
        }

        currentHunkStart = i;
        currentHunkHeader = line;
        const lineMatch = line.match(/@@ -(\d+)/);
        currentStartLine = lineMatch ? parseInt(lineMatch[1]) : 0;
      }
    }

    // Save last hunk
    if (currentHunkStart !== -1) {
      const hunkContent = lines.slice(currentHunkStart + 1).join('\n');
      const fullHunk = currentHunkHeader + '\n' + hunkContent;
      hunks.push({
        id: hunkId++,
        filePath,
        header: currentHunkHeader,
        content: hunkContent,
        fullHunk,
        startLine: currentStartLine,
        summary: generateHunkSummary(hunkContent),
      });
    }

    if (hunks.length > 0) {
      files.push({ filePath, fileHeader, hunks });
    }
  }

  return files;
}

/**
 * Generate a brief summary of what a hunk does
 */
function generateHunkSummary(content: string): string {
  const lines = content.split('\n');
  const added = lines.filter(l => l.startsWith('+')).slice(0, 3);
  const removed = lines.filter(l => l.startsWith('-')).slice(0, 3);

  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`+${added.map(l => l.slice(1).trim()).join(', ').slice(0, 50)}`);
  }
  if (removed.length > 0) {
    parts.push(`-${removed.map(l => l.slice(1).trim()).join(', ').slice(0, 50)}`);
  }

  return parts.join(' / ') || '(context only)';
}

/**
 * Rebuild a patch from selected hunks
 */
export function rebuildPatchFromHunks(
  files: ParsedFileDiff[],
  hunkIds: number[]
): string {
  const patchParts: string[] = [];
  const hunkSet = new Set(hunkIds);

  for (const file of files) {
    const selectedHunks = file.hunks.filter(h => hunkSet.has(h.id));
    if (selectedHunks.length === 0) continue;

    patchParts.push(file.fileHeader);
    for (const hunk of selectedHunks) {
      patchParts.push(hunk.fullHunk);
    }
  }

  return patchParts.join('\n') + '\n';
}

/**
 * A single changed line in a diff (+ or -)
 */
export interface ChangedLine {
  id: number;           // Unique ID for LLM reference
  filePath: string;
  hunkIdx: number;      // Index of hunk within file
  lineIdx: number;      // Index of this line within hunk content
  type: '+' | '-';
  content: string;      // Line content without +/- prefix
}

/**
 * Parsed diff with line-level granularity
 */
export interface ParsedDiffWithLines {
  files: ParsedFileDiff[];
  lines: ChangedLine[];
}

/**
 * Parse diff into hunks AND individual changed lines
 */
export function parseDiffWithLines(diff: string): ParsedDiffWithLines {
  const files = parseDiffIntoHunks(diff);
  const lines: ChangedLine[] = [];
  let lineId = 0;

  for (const file of files) {
    for (let hunkIdx = 0; hunkIdx < file.hunks.length; hunkIdx++) {
      const hunk = file.hunks[hunkIdx];
      const hunkLines = hunk.content.split('\n');

      for (let lineIdx = 0; lineIdx < hunkLines.length; lineIdx++) {
        const line = hunkLines[lineIdx];
        if (line.startsWith('+')) {
          lines.push({
            id: lineId++,
            filePath: file.filePath,
            hunkIdx,
            lineIdx,
            type: '+',
            content: line.slice(1),
          });
        } else if (line.startsWith('-')) {
          lines.push({
            id: lineId++,
            filePath: file.filePath,
            hunkIdx,
            lineIdx,
            type: '-',
            content: line.slice(1),
          });
        }
      }
    }
  }

  return { files, lines };
}

/**
 * Rebuild patch from selected line IDs
 * This rebuilds hunks by filtering out unselected +/- lines while keeping context
 */
export function rebuildPatchFromLineIds(
  parsed: ParsedDiffWithLines,
  lineIds: number[]
): string {
  const selectedSet = new Set(lineIds);
  const patchParts: string[] = [];

  // Group selected lines by file and hunk
  const selectedByFileHunk = new Map<string, Set<number>>();
  for (const line of parsed.lines) {
    if (selectedSet.has(line.id)) {
      const key = `${line.filePath}:${line.hunkIdx}`;
      if (!selectedByFileHunk.has(key)) {
        selectedByFileHunk.set(key, new Set());
      }
      selectedByFileHunk.get(key)!.add(line.lineIdx);
    }
  }

  for (const file of parsed.files) {
    const fileHunks: string[] = [];

    for (let hunkIdx = 0; hunkIdx < file.hunks.length; hunkIdx++) {
      const hunk = file.hunks[hunkIdx];
      const key = `${file.filePath}:${hunkIdx}`;
      const selectedLineIdxs = selectedByFileHunk.get(key);

      if (!selectedLineIdxs || selectedLineIdxs.size === 0) continue;

      // Parse the original @@ header
      const headerMatch = hunk.header.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)/);
      if (!headerMatch) continue;

      const origOldStart = parseInt(headerMatch[1]);
      const origNewStart = parseInt(headerMatch[3]);
      const suffix = headerMatch[5] || '';

      // Rebuild hunk content, keeping only selected +/- lines and their context
      const hunkLines = hunk.content.split('\n');
      const newHunkLines: string[] = [];
      let oldCount = 0;
      let newCount = 0;

      for (let lineIdx = 0; lineIdx < hunkLines.length; lineIdx++) {
        const line = hunkLines[lineIdx];

        // Skip empty lines at end of hunk (artifact of split)
        if (line === '' && lineIdx === hunkLines.length - 1) continue;

        if (line.startsWith('+')) {
          if (selectedLineIdxs.has(lineIdx)) {
            newHunkLines.push(line);
            newCount++;
          }
          // If not selected, skip (don't add to new file)
        } else if (line.startsWith('-')) {
          if (selectedLineIdxs.has(lineIdx)) {
            newHunkLines.push(line);
            oldCount++;
          } else {
            // Not selected - convert to context line (keep in both old and new)
            newHunkLines.push(' ' + line.slice(1));
            oldCount++;
            newCount++;
          }
        } else {
          // Context line - always keep (includes lines starting with ' ')
          newHunkLines.push(line);
          if (line.startsWith(' ') || line === '') {
            oldCount++;
            newCount++;
          }
        }
      }

      // Skip if no actual changes in this hunk
      const hasChanges = newHunkLines.some(l => l.startsWith('+') || l.startsWith('-'));
      if (!hasChanges) continue;

      // Build new header
      const newHeader = `@@ -${origOldStart},${oldCount} +${origNewStart},${newCount} @@${suffix}`;
      fileHunks.push(newHeader + '\n' + newHunkLines.join('\n'));
    }

    if (fileHunks.length > 0) {
      patchParts.push(file.fileHeader);
      patchParts.push(...fileHunks);
    }
  }

  return patchParts.join('\n') + '\n';
}
