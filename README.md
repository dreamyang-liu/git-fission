# git-fission

<p align="center">
  <img src="logo.svg" alt="git-fission logo" width="400"/>
</p>

<p align="center">
  <strong>Split large git commits into atomic pieces using AI</strong><br>
  <em>Like nuclear fission — a neutron hits a heavy nucleus and splits it into smaller, more stable fragments.</em>
</p>

---

## What is git-fission?

`git-fission` analyzes your git commits and helps you split large, non-atomic commits into smaller, focused pieces. It uses AI to understand the semantic meaning of your changes and suggest logical splits.

**Supported LLM Providers:**
- **Anthropic** (direct API)
- **OpenAI**
- **OpenRouter**
- **AWS Bedrock**

A commit is considered **atomic** if it:
- Does **one thing** (single logical change)
- Is **reasonably small** (not too many files/lines)
- Has **related changes** (files in same area)
- Has a **clear, descriptive commit message**

## Installation

```bash
# Clone the repository
git clone https://github.com/dreamyang-liu/git-fission.git
cd git-fission

# Install dependencies
npm install

# Build
npm run build

# Link globally (optional)
npm link
# or
ln -s "$(pwd)/dist/index.js" ~/.local/bin/git-fission
```

## Usage

### Check the last unpushed commit

```bash
git-fission
```

### Split a commit

```bash
# Split a commit into atomic pieces
git-fission --split HEAD

# Preview without executing
git-fission --split HEAD --dry-run

# With custom instruction
git-fission --split HEAD -i "Keep test files in a separate commit"

# Use different providers
git-fission --split HEAD -p anthropic                    # Anthropic (default model)
git-fission --split HEAD -p openai -m gpt-4o             # OpenAI
git-fission --split HEAD -m openrouter:anthropic/claude-3.5-haiku  # OpenRouter

# Use a specific model (Bedrock)
git-fission --split HEAD -m us.anthropic.claude-opus-4-5-20251101-v1:0
```

## How it works

```
                                              ·
                                         ◦
                                    ·  ◦
                               ◦              ⬤━━━━▶
        ╭─────────╮      ·
        │ ◉  ◉  ◉ │   ◦          ⬤━━━━━━━▶
●━━━━▶  │ ◉  ◉  ◉ │
        │ ◉  ◉  ◉ │   ◦          ⬤━━━━━━━▶
        ╰─────────╯      ·
                               ◦              ⬤━━━━▶
                                    ◦  ·
                                         ◦
                                              ·

                        ⚛  git-fission
                  Split commits into atomic pieces
```

1. **Neutron (your command)** hits the nucleus (your large commit)
2. **Fission occurs** — AI analyzes and splits the diff into logical pieces
3. **Fragments fly out** — multiple atomic commits are created
4. **Chain reaction** — cleaner git history!

## Example

Before:
```
abc1234 feat: Add user auth, API endpoints, database models, and tests
```

After running `git-fission --split abc1234`:
```
def5678 feat(auth): Add user authentication middleware
ghi9012 feat(api): Add user CRUD endpoints
jkl3456 feat(db): Add User and Session models
mno7890 test: Add user authentication tests
```

## Options

| Option | Description |
|--------|-------------|
| `-v, --verbose` | Verbose output |
| `-p, --provider <p>` | LLM provider: `bedrock`, `anthropic`, `openai`, `openrouter` |
| `-m, --model <id>` | Model ID (or use `provider:model` format) |
| `--split <commit>` | Split a commit into atomic pieces |
| `--dry-run` | Preview split without executing |
| `-i, --instruction` | Custom instruction for LLM |
| `-h, --help` | Show help |

### Model Format

You can specify the model in two ways:

```bash
# Using --provider and --model separately
git-fission -p anthropic -m claude-3-5-sonnet-20241022

# Using provider:model format (provider prefix)
git-fission -m anthropic:claude-3-5-sonnet-20241022
git-fission -m openai:gpt-4o
git-fission -m openrouter:anthropic/claude-3.5-haiku
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GIT_FISSION_PROVIDER` | Default provider (`bedrock`, `anthropic`, `openai`, `openrouter`) |
| `GIT_FISSION_MODEL` | Default model |
| `ANTHROPIC_API_KEY` | API key for Anthropic |
| `OPENAI_API_KEY` | API key for OpenAI |
| `OPENROUTER_API_KEY` | API key for OpenRouter |
| `AWS_BEARER_TOKEN_BEDROCK` | Bearer token for Bedrock API |
| `AWS_REGION` | AWS region (default: `us-west-2`) |

## Available Models Providers

### Anthropic (Direct API)

| Model | Description |
|-------|-------------|
| `claude-3-5-haiku-20241022` | Default, fast |
| `claude-3-5-sonnet-20241022` | Balanced |
| `claude-sonnet-4-20250514` | Recommended |
| `claude-opus-4-20250514` | Most capable |

### OpenAI

| Model | Description |
|-------|-------------|
| `gpt-5-mini-2025-08-07` | fast & cheap |
| `gpt-5.2-2025-12-11` | High capability |

### OpenRouter

| Model | Description |
|-------|-------------|
| `anthropic/claude-3.5-haiku` | Default |
| `anthropic/claude-3.5-sonnet` | Balanced |
| `openai/gpt-4o` | OpenAI via OpenRouter |

### AWS Bedrock

| Model | Description |
|-------|-------------|
| `us.anthropic.claude-3-5-haiku-20241022-v1:0` | Default |
| `us.anthropic.claude-sonnet-4-20250514-v1:0` | Recommended |
| `us.anthropic.claude-opus-4-5-20251101-v1:0` | Most capable |

## Features

- **Multi-Provider Support**: Works with Anthropic, OpenAI, OpenRouter, and AWS Bedrock
- **LLM Analysis**: Deep semantic analysis using state-of-the-art language models
- **Auto-Split**: Automatically split large commits into atomic ones
- **Hunk-Level Splitting**: Fast & stable, splits at diff hunk boundaries
- **Custom Instructions**: Guide the LLM with custom splitting rules

## How Splitting Works

The tool operates at the **hunk level**. A hunk is a contiguous block of changes in a diff (the sections starting with `@@`). The AI analyzes each hunk and classifies them into logical groups.

```
Original commit with 3 hunks in file.ts:
┌─────────────────────────────────┐
│ @@ -10,5 +10,8 @@  ← Hunk 1    │
│ @@ -50,3 +53,6 @@  ← Hunk 2    │
│ @@ -100,4 +106,4 @@ ← Hunk 3   │
└─────────────────────────────────┘
           ↓ git-fission --split
┌─────────────┐  ┌─────────────┐
│ Commit A    │  │ Commit B    │
│ Hunk 1 + 3  │  │ Hunk 2      │
└─────────────┘  └─────────────┘
```

## Requirements

- Node.js 18+
- Git repository
- API key for your chosen provider:
  - **Anthropic**: `ANTHROPIC_API_KEY`
  - **OpenAI**: `OPENAI_API_KEY`
  - **OpenRouter**: `OPENROUTER_API_KEY`
  - **AWS Bedrock**: AWS credentials or `AWS_BEARER_TOKEN_BEDROCK`

## License

MIT
