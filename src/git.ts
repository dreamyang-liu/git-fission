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
 * Rebuild a patch from selected hunks, properly adjusting line numbers
 * to account for changes from previous hunks in this patch.
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

    // Track cumulative line offset for this file
    // (lines added minus lines removed by previous hunks in THIS patch)
    let cumulativeOffset = 0;

    for (const hunk of selectedHunks) {
      // Parse the original @@ header
      const headerMatch = hunk.header.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)/);
      if (!headerMatch) {
        // Fallback to original if can't parse
        patchParts.push(hunk.fullHunk);
        continue;
      }

      const oldStart = parseInt(headerMatch[1]);
      const oldCount = headerMatch[2] ? parseInt(headerMatch[2]) : 1;
      const newCount = headerMatch[4] ? parseInt(headerMatch[4]) : 1;
      const suffix = headerMatch[5] || '';

      // Calculate adjusted new start based on cumulative offset
      const adjustedNewStart = oldStart + cumulativeOffset;

      // Build new header with adjusted line number
      const newHeader = `@@ -${oldStart},${oldCount} +${adjustedNewStart},${newCount} @@${suffix}`;

      // Rebuild the hunk with new header
      patchParts.push(newHeader + '\n' + hunk.content);

      // Update cumulative offset for next hunk
      // (lines added - lines removed in this hunk)
      cumulativeOffset += (newCount - oldCount);
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
/**
 * Check if a file header indicates a new file
 */
function isNewFileHeader(header: string): boolean {
  return header.includes('new file mode') || header.includes('--- /dev/null');
}

/**
 * Convert a new file header to a modification header
 * This is needed when a new file is split across multiple patches -
 * only the first patch should create the file, subsequent ones should modify it
 */
function convertNewFileToModificationHeader(header: string, filePath: string): string {
  const lines = header.split('\n');
  const newLines: string[] = [];

  for (const line of lines) {
    // Skip "new file mode" line
    if (line.startsWith('new file mode')) continue;

    // Convert "--- /dev/null" to "--- a/filepath"
    if (line === '--- /dev/null') {
      newLines.push(`--- a/${filePath}`);
      continue;
    }

    // Keep other lines (diff --git, index, +++ b/filepath)
    newLines.push(line);
  }

  return newLines.join('\n');
}

export function rebuildPatchFromLineIds(
  parsed: ParsedDiffWithLines,
  lineIds: number[],
  createdFiles?: Set<string>  // Track new files already created by previous patches
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
    // Track cumulative line offset for this file (lines added minus lines removed by previous hunks)
    let cumulativeOffset = 0;

    for (let hunkIdx = 0; hunkIdx < file.hunks.length; hunkIdx++) {
      const hunk = file.hunks[hunkIdx];
      const key = `${file.filePath}:${hunkIdx}`;
      const selectedLineIdxs = selectedByFileHunk.get(key);

      // Parse the original @@ header to get line counts even for skipped hunks
      const headerMatch = hunk.header.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)/);
      if (!headerMatch) continue;

      const origOldStart = parseInt(headerMatch[1]);
      const suffix = headerMatch[5] || '';

      if (!selectedLineIdxs || selectedLineIdxs.size === 0) {
        // Skip this hunk, but don't update offset - we're not including its changes
        continue;
      }

      // Calculate newStart based on oldStart + cumulative offset from previous hunks in this patch
      const newStart = origOldStart + cumulativeOffset;

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

      // Build new header using calculated newStart
      const newHeader = `@@ -${origOldStart},${oldCount} +${newStart},${newCount} @@${suffix}`;
      fileHunks.push(newHeader + '\n' + newHunkLines.join('\n'));

      // Update cumulative offset for next hunk (lines added - lines removed in this hunk)
      cumulativeOffset += (newCount - oldCount);
    }

    if (fileHunks.length > 0) {
      let header = file.fileHeader;

      // Handle new files split across patches
      if (isNewFileHeader(header)) {
        if (createdFiles?.has(file.filePath)) {
          // This new file was already created by a previous patch - convert to modification
          header = convertNewFileToModificationHeader(header, file.filePath);
        } else {
          // First patch to create this file - mark it as created
          createdFiles?.add(file.filePath);
        }
      }

      patchParts.push(header);
      patchParts.push(...fileHunks);
    }
  }

  return patchParts.join('\n') + '\n';
}

/**
 * Apply line changes to file content.
 * Takes the original content and a list of changes (add/remove at specific lines).
 * Returns the modified content.
 */
export function applyChangesToContent(
  originalContent: string,
  changes: Array<{ type: '+' | '-'; lineNum: number; content: string }>
): string {
  const lines = originalContent.split('\n');

  // Sort changes by line number (descending) so we can apply from bottom up
  // This prevents line number shifts from affecting subsequent changes
  const sortedChanges = [...changes].sort((a, b) => b.lineNum - a.lineNum);

  for (const change of sortedChanges) {
    if (change.type === '-') {
      // Remove line at lineNum (0-indexed)
      lines.splice(change.lineNum, 1);
    } else {
      // Add line at lineNum (0-indexed, inserts before)
      lines.splice(change.lineNum, 0, change.content);
    }
  }

  return lines.join('\n');
}

/**
 * Generate a unified diff patch between two strings.
 * Uses a simple line-by-line diff algorithm.
 */
export function generateUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
  isNewFile: boolean = false,
  contextLines: number = 3
): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Simple LCS-based diff
  const diff = computeLineDiff(oldLines, newLines);

  if (diff.length === 0) {
    return ''; // No changes
  }

  // Check if there are any actual changes
  const hasChanges = diff.some(op => op.type !== 'keep');
  if (!hasChanges) {
    return '';
  }

  // Build hunks with context
  const hunks = buildHunksFromDiff(diff, oldLines, newLines, contextLines);

  if (hunks.length === 0) {
    return '';
  }

  // Build patch header
  const parts: string[] = [];
  parts.push(`diff --git a/${filePath} b/${filePath}`);

  if (isNewFile) {
    parts.push('new file mode 100644');
    parts.push('index 0000000..0000000');
    parts.push('--- /dev/null');
  } else {
    parts.push('index 0000000..0000000 100644');
    parts.push(`--- a/${filePath}`);
  }
  parts.push(`+++ b/${filePath}`);

  // Add hunks
  for (const hunk of hunks) {
    parts.push(hunk);
  }

  return parts.join('\n') + '\n';
}

interface DiffOp {
  type: 'keep' | 'add' | 'remove';
  oldIdx?: number;
  newIdx?: number;
  line: string;
}

/**
 * Compute line-by-line diff using simple algorithm
 */
function computeLineDiff(oldLines: string[], newLines: string[]): DiffOp[] {
  // Use Myers diff algorithm approximation
  const ops: DiffOp[] = [];

  // Build a map of line content to positions in new file
  const newLineMap = new Map<string, number[]>();
  newLines.forEach((line, idx) => {
    if (!newLineMap.has(line)) newLineMap.set(line, []);
    newLineMap.get(line)!.push(idx);
  });

  // Track which new lines have been matched
  const matchedNew = new Set<number>();
  const matches: Array<{ oldIdx: number; newIdx: number }> = [];

  // Find matching lines (greedy LCS approximation)
  let lastNewMatch = -1;
  for (let oldIdx = 0; oldIdx < oldLines.length; oldIdx++) {
    const line = oldLines[oldIdx];
    const candidates = newLineMap.get(line) || [];

    // Find first unmatched candidate after lastNewMatch
    for (const newIdx of candidates) {
      if (newIdx > lastNewMatch && !matchedNew.has(newIdx)) {
        matches.push({ oldIdx, newIdx });
        matchedNew.add(newIdx);
        lastNewMatch = newIdx;
        break;
      }
    }
  }

  // Build diff ops from matches
  let oldPtr = 0;
  let newPtr = 0;

  for (const match of matches) {
    // Add removals for old lines before match
    while (oldPtr < match.oldIdx) {
      ops.push({ type: 'remove', oldIdx: oldPtr, line: oldLines[oldPtr] });
      oldPtr++;
    }
    // Add additions for new lines before match
    while (newPtr < match.newIdx) {
      ops.push({ type: 'add', newIdx: newPtr, line: newLines[newPtr] });
      newPtr++;
    }
    // Add keep for matched line
    ops.push({ type: 'keep', oldIdx: oldPtr, newIdx: newPtr, line: oldLines[oldPtr] });
    oldPtr++;
    newPtr++;
  }

  // Add remaining removals
  while (oldPtr < oldLines.length) {
    ops.push({ type: 'remove', oldIdx: oldPtr, line: oldLines[oldPtr] });
    oldPtr++;
  }
  // Add remaining additions
  while (newPtr < newLines.length) {
    ops.push({ type: 'add', newIdx: newPtr, line: newLines[newPtr] });
    newPtr++;
  }

  return ops;
}

/**
 * Build hunks from diff operations with context
 */
function buildHunksFromDiff(
  ops: DiffOp[],
  oldLines: string[],
  newLines: string[],
  contextLines: number
): string[] {
  // Group consecutive changes into hunks
  const hunks: string[] = [];

  let hunkStart = -1;
  let hunkOps: DiffOp[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];

    if (op.type !== 'keep') {
      // Start or extend hunk
      if (hunkStart === -1) {
        // Start new hunk - include context before
        hunkStart = Math.max(0, i - contextLines);
        for (let j = hunkStart; j < i; j++) {
          hunkOps.push(ops[j]);
        }
      }
      hunkOps.push(op);
    } else if (hunkStart !== -1) {
      // We're in a hunk, check if we should end it
      // Look ahead to see if there's another change within context
      let nextChange = -1;
      for (let j = i + 1; j < ops.length && j <= i + contextLines * 2; j++) {
        if (ops[j].type !== 'keep') {
          nextChange = j;
          break;
        }
      }

      if (nextChange !== -1 && nextChange - i <= contextLines * 2) {
        // Continue hunk
        hunkOps.push(op);
      } else {
        // End hunk - add trailing context
        for (let j = i; j < Math.min(ops.length, i + contextLines); j++) {
          if (ops[j].type === 'keep') {
            hunkOps.push(ops[j]);
          } else {
            break;
          }
        }

        // Build hunk string
        const hunk = buildHunkString(hunkOps, oldLines, newLines);
        if (hunk) hunks.push(hunk);

        hunkStart = -1;
        hunkOps = [];
      }
    }
  }

  // Handle any remaining hunk
  if (hunkOps.length > 0) {
    const hunk = buildHunkString(hunkOps, oldLines, newLines);
    if (hunk) hunks.push(hunk);
  }

  return hunks;
}

/**
 * Build a single hunk string from operations
 */
function buildHunkString(ops: DiffOp[], _oldLines: string[], _newLines: string[]): string | null {
  if (ops.length === 0) return null;

  // Calculate line numbers
  let oldStart = Infinity;
  let newStart = Infinity;
  let oldCount = 0;
  let newCount = 0;

  const lines: string[] = [];

  for (const op of ops) {
    if (op.type === 'keep') {
      if (op.oldIdx !== undefined && op.oldIdx < oldStart) oldStart = op.oldIdx;
      if (op.newIdx !== undefined && op.newIdx < newStart) newStart = op.newIdx;
      oldCount++;
      newCount++;
      lines.push(' ' + op.line);
    } else if (op.type === 'remove') {
      if (op.oldIdx !== undefined && op.oldIdx < oldStart) oldStart = op.oldIdx;
      oldCount++;
      lines.push('-' + op.line);
    } else if (op.type === 'add') {
      if (op.newIdx !== undefined && op.newIdx < newStart) newStart = op.newIdx;
      newCount++;
      lines.push('+' + op.line);
    }
  }

  // Adjust to 1-based line numbers
  oldStart = oldStart === Infinity ? 1 : oldStart + 1;
  newStart = newStart === Infinity ? 1 : newStart + 1;

  // Handle edge case of empty old/new
  if (oldCount === 0) oldStart = 0;
  if (newCount === 0) newStart = 0;

  const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
  return header + '\n' + lines.join('\n');
}

/**
 * Data structure for tracking file changes across commits
 */
export interface FileChange {
  filePath: string;
  lineIds: number[];  // Which line IDs from parsed.lines are in this change
}

/**
 * Build patches for all commits, handling the case where the same file
 * is modified by multiple commits. Tracks file state across patches.
 */
export function buildPatchesWithFileTracking(
  parsed: ParsedDiffWithLines,
  commits: Array<{ message: string; description: string; lineIds: number[] }>,
  commitHash: string  // To get original file content
): Array<{ message: string; description: string; diff: string }> {
  // Track current state of each file (starts with content from HEAD~1)
  const fileStates = new Map<string, string>();
  const newFiles = new Set<string>();
  const createdInPatch = new Set<string>();  // Files created by earlier patches

  // Identify new files from parsed diff
  for (const file of parsed.files) {
    if (file.fileHeader.includes('new file mode') || file.fileHeader.includes('--- /dev/null')) {
      newFiles.add(file.filePath);
      fileStates.set(file.filePath, '');  // New file starts empty
    } else {
      // Get original file content
      const content = getFileAtRef(`${commitHash}~1`, file.filePath);
      if (content !== null) {
        fileStates.set(file.filePath, content);
      }
    }
  }

  // Build a map of line ID to line info
  const lineMap = new Map<number, ChangedLine>();
  for (const line of parsed.lines) {
    lineMap.set(line.id, line);
  }

  // Process each commit
  const results: Array<{ message: string; description: string; diff: string }> = [];

  for (const commit of commits) {
    const patchParts: string[] = [];

    // Group line IDs by file
    const changesByFile = new Map<string, number[]>();
    for (const lineId of commit.lineIds) {
      const line = lineMap.get(lineId);
      if (!line) continue;
      if (!changesByFile.has(line.filePath)) {
        changesByFile.set(line.filePath, []);
      }
      changesByFile.get(line.filePath)!.push(lineId);
    }

    // Process each file in this commit
    for (const [filePath, lineIds] of changesByFile) {
      const currentContent = fileStates.get(filePath) || '';
      const file = parsed.files.find(f => f.filePath === filePath);
      if (!file) continue;

      // Build target content by applying selected changes
      const currentLines = currentContent.split('\n');
      const finalLines = [...currentLines];
      let offset = 0;

      for (const hunk of file.hunks) {
        const hunkLines = hunk.content.split('\n');
        let posInOld = hunk.startLine - 1;  // 0-indexed position in original file

        for (let lineIdx = 0; lineIdx < hunkLines.length; lineIdx++) {
          const hunkLine = hunkLines[lineIdx];
          if (hunkLine === '' && lineIdx === hunkLines.length - 1) continue;

          const matchingLine = parsed.lines.find(
            l => l.filePath === filePath && l.hunkIdx === file.hunks.indexOf(hunk) && l.lineIdx === lineIdx
          );
          const isSelected = matchingLine && lineIds.includes(matchingLine.id);

          if (hunkLine.startsWith('-')) {
            if (isSelected) {
              // Remove this line
              if (posInOld + offset >= 0 && posInOld + offset < finalLines.length) {
                finalLines.splice(posInOld + offset, 1);
                offset--;
              }
            }
            posInOld++;
          } else if (hunkLine.startsWith('+')) {
            if (isSelected) {
              // Add this line
              const insertPos = Math.max(0, Math.min(finalLines.length, posInOld + offset));
              finalLines.splice(insertPos, 0, hunkLine.slice(1));
              offset++;
            }
          } else if (hunkLine.startsWith(' ')) {
            posInOld++;
          }
        }
      }

      const targetContent = finalLines.join('\n');

      // Generate unified diff
      const isNewFile = newFiles.has(filePath) && !createdInPatch.has(filePath);
      const diff = generateUnifiedDiff(filePath, currentContent, targetContent, isNewFile);

      if (diff) {
        patchParts.push(diff);
        // Update file state for next patch
        fileStates.set(filePath, targetContent);
        if (isNewFile) {
          createdInPatch.add(filePath);
        }
      }
    }

    results.push({
      message: commit.message,
      description: commit.description,
      diff: patchParts.join(''),
    });
  }

  return results;
}
