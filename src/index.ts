#!/usr/bin/env node
/**
 * git-fission: Split large commits into atomic pieces using AI.
 *
 * Like nuclear fission - a neutron hits a heavy nucleus and splits it
 * into smaller, more stable fragments. This tool does the same for
 * your commits: analyze a large commit and split it into atomic pieces.
 */

import { c, LOGO, DEFAULT_MODEL, SPLIT_MODEL } from './config.js';
import { runGit, getUnpushedCommits, getCommitInfo } from './git.js';
import { checkCommitAtomicity, printReport } from './check.js';
import { splitCommit } from './split.js';

async function main() {
  const args = process.argv.slice(2);

  const flags = {
    n: undefined as number | undefined,
    verbose: false,
    model: process.env.GIT_FISSION_MODEL || DEFAULT_MODEL,
    split: undefined as string | undefined,
    splitModel: process.env.GIT_FISSION_SPLIT_MODEL || SPLIT_MODEL,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-n' || arg === '--number') flags.n = parseInt(args[++i]);
    else if (arg === '-v' || arg === '--verbose') flags.verbose = true;
    else if (arg === '--model') flags.model = args[++i];
    else if (arg === '--split') flags.split = args[++i];
    else if (arg === '--split-model') flags.splitModel = args[++i];
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '-h' || arg === '--help') flags.help = true;
  }

  if (flags.help) {
    console.log(`
${LOGO}
Usage: git-fission [options]

Options:
  -n, --number <n>     Check last n unpushed commits
  -v, --verbose        Verbose output
  --model <id>         Bedrock model ID for analysis
  --split <commit>     Split a commit into atomic commits
  --split-model <id>   Model for split analysis
  --dry-run            Preview split without executing
  -h, --help           Show help

Environment:
  AWS_BEARER_TOKEN_BEDROCK   Bearer token for Bedrock
  AWS_REGION                 AWS region (default: us-west-2)
  GIT_FISSION_MODEL          Default model for analysis
  GIT_FISSION_SPLIT_MODEL    Default model for split
`);
    process.exit(0);
  }

  // Check if in git repo
  const { ok } = runGit(['rev-parse', '--git-dir']);
  if (!ok) {
    console.log(`${c.red}Error: Not a git repository${c.reset}`);
    process.exit(1);
  }

  // Split mode
  if (flags.split) {
    const success = await splitCommit(flags.split, flags.splitModel, flags.dryRun);
    process.exit(success ? 0 : 1);
  }

  // Check mode
  const commits = getUnpushedCommits(flags.n);
  if (!commits.length) {
    console.log(`${c.green}✓ No unpushed commits to check${c.reset}`);
    process.exit(0);
  }

  console.log(LOGO);
  console.log(`${c.bold}Checking ${commits.length} unpushed commit(s)...${c.reset} [LLM: ${flags.model.split('/').pop()}]`);

  let allAtomic = true;
  let totalScore = 0;

  for (const hash of commits.reverse()) {
    const commit = getCommitInfo(hash, true);
    if (!commit) {
      console.log(`${c.yellow}Warning: Could not get info for ${hash.slice(0, 8)}${c.reset}`);
      continue;
    }

    const report = await checkCommitAtomicity(commit, flags.model);
    printReport(report, flags.verbose);

    if (!report.isAtomic) allAtomic = false;
    totalScore += report.score;
  }

  const avgScore = totalScore / commits.length;
  console.log(`\n${c.bold}${'─'.repeat(50)}${c.reset}`);

  if (allAtomic) {
    console.log(`${c.green}✓ All ${commits.length} commits are atomic!${c.reset} (avg score: ${avgScore.toFixed(0)}/100)`);
    process.exit(0);
  } else {
    console.log(`${c.red}✗ Some commits are not atomic${c.reset} (avg score: ${avgScore.toFixed(0)}/100)`);
    console.log(`\n${c.yellow}Tip: Use 'git-fission --split HEAD' to split the last commit.${c.reset}`);
    process.exit(1);
  }
}

main().catch(console.error);
