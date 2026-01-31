# git-atomic-check

```
   ⚛️  git-atomic-check
  ╭─────────────────────╮
  │  ✓ One thing only   │
  │  ✓ Small & focused  │
  │  ✓ Clean history    │
  ╰─────────────────────╯
```

Check if your unpushed git commits are atomic/self-contained. **Now in TypeScript for faster startup!**

## Installation

```bash
# Clone and build
cd ~/clawd/tools/git-atomic-check
npm install && npm run build

# Link globally
npm link
# or
ln -s "$(pwd)/dist/index.js" ~/.local/bin/git-atomic-check
```

## Usage

```bash
# Heuristic check (fast, offline)
git-atomic-check

# LLM semantic analysis (uses AWS Bedrock)
git-atomic-check --llm

# Use specific model
git-atomic-check --llm --model us.anthropic.claude-sonnet-4-20250514-v1:0

# Check last 3 commits
git-atomic-check -n 3

# Strict mode
git-atomic-check --strict

# Split a non-atomic commit
git-atomic-check --split HEAD
git-atomic-check --split HEAD --dry-run
```

## Features

- **Heuristic Analysis**: Fast offline check for file count, line count, directory spread, message quality
- **LLM Analysis**: Deep semantic analysis using AWS Bedrock Claude models
- **Auto-Split**: Automatically split large commits into atomic ones using LLM

## Environment Variables

```bash
export AWS_BEARER_TOKEN_BEDROCK=...      # Bearer token for Bedrock
export AWS_REGION=us-west-2              # AWS region
export GIT_ATOMIC_CHECK_MODEL=...        # Default model for --llm
export GIT_ATOMIC_CHECK_SPLIT_MODEL=...  # Default model for --split
```

## Available Models

| Model | Use Case |
|-------|----------|
| `us.anthropic.claude-3-5-haiku-20241022-v1:0` | Default for `--llm` (fast) |
| `us.anthropic.claude-sonnet-4-20250514-v1:0` | Default for `--split` (accurate) |

## License

MIT
