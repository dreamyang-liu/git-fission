/**
 * Patch validation and fixing utilities
 */

export interface PatchValidationResult {
  valid: boolean;
  fixed: string;
  errors: string[];
  warnings: string[];
}

/**
 * Validate and fix common issues with a patch
 */
export function validateAndFixPatch(diff: string, index: number): PatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let fixed = diff;

  // Fix 1: Unescape literal \n that should be newlines (common LLM issue)
  if (fixed.includes('\\n') && !fixed.includes('\n')) {
    fixed = fixed.replace(/\\n/g, '\n');
  }

  // Fix 2: Ensure trailing newline
  if (!fixed.endsWith('\n')) {
    fixed += '\n';
  }

  // Fix 3: Remove any leading/trailing whitespace on the whole patch
  fixed = fixed.trim() + '\n';

  // Validation checks
  const lines = fixed.split('\n');

  // Check 1: Must start with "diff --git"
  if (!lines[0]?.startsWith('diff --git')) {
    errors.push(`Patch ${index + 1}: Missing "diff --git" header`);
  }

  // Check 2: Must have --- and +++ lines
  const hasMinusLine = lines.some(l => l.startsWith('--- '));
  const hasPlusLine = lines.some(l => l.startsWith('+++ '));
  if (!hasMinusLine || !hasPlusLine) {
    errors.push(`Patch ${index + 1}: Missing --- or +++ file headers`);
  }

  // Check 3: Must have at least one hunk header (@@ ... @@)
  const hasHunk = lines.some(l => l.startsWith('@@') && l.includes('@@', 2));
  if (!hasHunk) {
    errors.push(`Patch ${index + 1}: Missing hunk header (@@ ... @@)`);
  }

  // Note: We skip strict hunk line count validation here.
  // Off-by-one mismatches are common due to "\ No newline at end of file" markers
  // and context line handling. Let git apply --check do the authoritative validation.

  return { valid: errors.length === 0, fixed, errors, warnings };
}
