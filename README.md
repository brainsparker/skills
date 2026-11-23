# How I Build

*PM Skills for 2026*

Product management in 2026 isn't strategy *or* build — it's both, in the same head, on the same day. Positioning, marketing, messaging, pricing, packaging on one side. Writing code, reviewing code, scaffolding new repos, understanding the market on the other. The job is to create value, not to ship blindly.

This repo is the collection of [Claude](https://claude.com/claude-code) skills I use to do that work. Each one is small, opinionated, and composable — you can run them from Claude Code, Claude.ai, or any agent that reads `SKILL.md`. Take them, fork them, see how I work.

## Skills

- [**bold-claim**](./skills/bold-claim/SKILL.md) *(positioning)* — Find the single contested sentence that drives a product's GTM motion. Researches the competitive landscape, generates 5–7 claim candidates across six archetypes, scores them against a 25-point sharpness rubric, and produces a messaging doc anchored on the winning claim.
- [**claim-review**](./skills/claim-review/SKILL.md) *(review)* — PM-lens code review. Scores a PR against the asserted claim across five dimensions (claim-aligned, surface-honest, felt-value, scope-honest, voice-aligned) and names the concrete gaps between what was promised and what the code ships. Composes with bold-claim.
- [**quickstart**](./skills/quickstart/SKILL.md) *(development)* — Scaffold a new CLI tool or script with my conventions. Interviews you for language and purpose, then sets up the directory, writes the starter files, lands the first commit. For the cases `create-*-app` doesn't cover.

More on the way — launch narratives, pricing positioning, customer-research synthesis, founder one-liners on the strategy side; repo hygiene and market-mapping skills on the build side. If there's a specific PM job you want a skill for, open an issue.

## Install

### Any agent: Claude Code, Codex, Cursor, Copilot, Gemini CLI and others

These are standard [Agent Skills](https://agentskills.io), so the [`skills` CLI](https://github.com/vercel-labs/skills) can install them into whichever agents you use. Run it from your project root:

```bash
npx skills add brainsparker/skills
```

It asks which skills and which agents. To skip the prompts, name them:

```bash
npx skills add brainsparker/skills --skill bold-claim -a claude-code codex cursor -y
```

Add `-g` to install for every project instead of the current one.

With the [GitHub CLI](https://cli.github.com/manual/gh_skill_install):

```bash
gh skill install brainsparker/skills --all
```

### Claude Code plugin (all skills, with updates)

In a Claude Code session:

```text
/plugin install brainsparker-skills --marketplace brainsparker/skills
```

Or from your shell:

```bash
claude plugin install brainsparker-skills --marketplace brainsparker/skills
```

Both add this repo as a marketplace and install the plugin from it. On Claude Code older than 2.1.275, do it in two steps: `/plugin marketplace add brainsparker/skills`, then `/plugin install brainsparker-skills@brainsparker`. Installed this way, the skills are namespaced, for example `/brainsparker-skills:bold-claim`.

### By hand

A skill is one folder. Copy it to where your agent looks:

| Agent | Project | Personal |
| --- | --- | --- |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| Codex | `.agents/skills/` | `~/.agents/skills/` |
| Cursor | `.agents/skills/` | `~/.cursor/skills/` |
| GitHub Copilot | `.agents/skills/` | `~/.copilot/skills/` |
| Gemini CLI | `.agents/skills/` | `~/.gemini/skills/` |

```bash
git clone https://github.com/brainsparker/skills.git /tmp/brainsparker-skills
mkdir -p ~/.claude/skills
cp -R /tmp/brainsparker-skills/skills/bold-claim ~/.claude/skills/
```

### Claude.ai

Upload the relevant `SKILL.md` to a Project. The skill activates whenever the conversation matches the trigger phrases in its frontmatter.

## Repo layout

```
.claude-plugin/
  plugin.json          # the Claude Code plugin: lists every skill in this repo
  marketplace.json     # lets Claude Code install that plugin straight from this repo
skills/
  bold-claim/
    SKILL.md
  claim-review/
    SKILL.md
  quickstart/
    SKILL.md
scripts/
  validate.mjs         # checks every skill and both manifests
  validate.test.mjs
```

Each skill lives in its own folder under `skills/`.

## Adding or editing a skill

Run the check before you push. It needs Node 20 or later and nothing else:

```bash
node scripts/validate.mjs
```

It fails when a skill would not install everywhere:

- `SKILL.md` breaks the [Agent Skills spec](https://agentskills.io/specification): name not matching its folder, description over 1,024 characters, a frontmatter field outside the six the spec allows.
- The frontmatter is YAML that only lenient parsers accept. The common case is a colon followed by a space inside an unquoted description. Claude Code reads it, but strict installers skip the skill without failing the install.
- A skill folder is missing from `plugin.json` or from this README, or `marketplace.json` no longer matches `plugin.json`.

The check has its own tests: `node --test`.

## License

MIT — see [`LICENSE`](./LICENSE).
