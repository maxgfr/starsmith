# starsmith

> A GitHub Action that turns your GitHub stars into a curated awesome list: Markdown that stays
> readable at 5,000 stars, a searchable static site, a feed, and optional AI categories,
> descriptions and digest.

**Live example:** [maxgfr/awesome-stars](https://github.com/maxgfr/awesome-stars), 4,800+ stars
sorted by AI into categories, rebuilt daily by
[its workflow](https://github.com/maxgfr/awesome-stars/blob/main/.github/workflows/stars.yml).

## Why

- **Small diffs.** Star counts are compact (`12.3k`), the order is total (ties broken by name), and
  the "Updated" date only moves when the content does. An idle day commits nothing, instead of
  rewriting thousands of lines.
- **Fast.** Stars are fetched page by page in parallel: about 30 seconds for 5,000 stars.
- **Verified commits.** Changes are committed through the GitHub API, so GitHub signs them. This
  works with branch protections that require signed commits.
- **Scales.** GitHub stops rendering very large Markdown files, so past `split-threshold` (500 KB)
  the list becomes one file per group (per language, per AI category…) and the README an index
  showing the top repositories of each group with a link to its full file.
- **AI that costs nothing on a normal day.** Every result is cached per repository in
  `.starsmith/state.json`, so only new or changed stars reach the model. GitHub Models works with
  the workflow token, with no secret to create.

## Quick start

```yaml
# .github/workflows/stars.yml
name: Update stars
on:
  schedule:
    - cron: "30 18 * * *"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  stars:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: maxgfr/starsmith@v1
```

This writes `README.md`, grouped by language, and commits it. A large list is split
automatically: `README.md` becomes an index, and each group gets its own file in `stars/`
(`stars/rust.md`, `stars/web-frameworks.md`…). Set `split: always` to get one file per group even
for a small list.

## With AI

```yaml
permissions:
  contents: write
  models: read # GitHub Models, with the workflow token

# …
      - uses: maxgfr/starsmith@v1
        with:
          group-by: ai-category
          ai: true
          ai-language: fr # optional: categories, descriptions and digest in French
```

What the AI does (`ai-features`, all three by default):

| Feature | What it does | Cached by |
| --- | --- | --- |
| `categorize` | Derives 12–30 categories from a sample of your stars once (or uses `ai-categories`), then puts each repository in one | repository + description + topics + categories |
| `describe` | Rewrites descriptions as short one-liners, in `ai-language` | description + language |
| `digest` | Writes a short summary of the stars of the last `ai-digest-days` days, at the top | newest star + language |

On a large history, the first pass takes several runs: each run makes at most `ai-max-calls`
calls (60 by default) and the next one picks up where it stopped. Until `ai-min-coverage` (90 %)
of the stars have a category, the list stays grouped by language. If the AI fails, the run keeps
going without it.

### Providers

Calls go through [llm-connect](https://github.com/maxgfr/llm-models/tree/main/packages/llm-connect)
and the [AI SDK](https://ai-sdk.dev). When `ai-model` is not set, the default is the provider's
latest small model, looked up with [llm-models](https://github.com/maxgfr/llm-models).

| `ai-provider` | Needs | Default model |
| --- | --- | --- |
| `github-models` (default) | `permissions: models: read` | `openai/gpt-4.1-mini` |
| `openai`, `anthropic`, `google`, `mistral` | `ai-api-key` | latest small model of the provider |
| `openrouter` | `ai-api-key` | latest small model on OpenRouter |
| `custom` | `ai-base-url`, `ai-model` (Ollama, vLLM, LM Studio… any OpenAI-compatible API) | — |

```yaml
      - uses: maxgfr/starsmith@v1
        with:
          ai: true
          ai-provider: anthropic
          ai-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

On GitHub Models' free tier, calls are spaced 4.5 s apart (`ai-min-interval-ms`). When the provider
answers with a long `Retry-After`, the run stops the AI work and keeps what it has.

## Static site and feed

```yaml
      - uses: maxgfr/starsmith@v1
        with:
          html-output: docs/index.html
          json-output: docs/stars.json
          feed-output: docs/feed.xml
```

`docs/index.html` is a single file with no dependencies. It offers search, group and language
filters, sorting and dark mode, and the URL keeps the filter state so a view can be shared. To
serve it, enable GitHub Pages with **Deploy from a branch** on the `/docs` folder. `stars.json`
has one repository per line and `feed.xml` is an Atom feed of your latest stars.

## Options

Every option can be an input of the step, or a key of `.github/starsmith.yml` (inputs win).

### Output

| Option | Default | |
| --- | --- | --- |
| `username` | repository owner | Whose stars |
| `output` | `README.md` | Markdown file |
| `title` | `Awesome Stars` | |
| `description` | credit line | Line under the title |
| `locale` | `en` | Fixed texts: `en` or `fr` |
| `header` / `footer` | | Markdown replacing the title block / added before the credit |
| `split` | `auto` | `auto` (past `split-threshold`), `always`, `never`: one file per group |
| `split-dir` | `stars` | Folder of the per-group files, next to `output` |
| `split-threshold` | `500` | KB. The index also stays under it: previews are dropped if needed |
| `split-preview` | `5` | Repositories of each group kept in the index, then a link to the full file. `0`: links only |
| `html-output`, `json-output`, `feed-output` | | Extra outputs |
| `feed-size` | `50` | |

### Layout

| Option | Default | |
| --- | --- | --- |
| `group-by` | `language` | `language`, `topic`, `list` (your GitHub star lists), `ai-category`, `none` |
| `sort` / `order` | `stars` / `desc` | `stars`, `name`, `starred-at`, `pushed-at` |
| `format` | `table` | `table` or `list` |
| `columns` | `name,description,author,stars` | Also `index`, `language`, `topics`, `license`, `pushed`, `starred` |
| `star-format` | `compact` | `compact` (12.3k) or `exact` |
| `badges` | `archived,stale` | Also `new`, `fork` |
| `stale-days` / `new-days` | `730` / `30` | |
| `recent-count` | `10` | "Recently starred" section, `0` hides it |
| `stats` | `true` | Totals, languages pie and stars per year (Mermaid) |
| `toc`, `back-to-top` | `true` | |
| `collapse-threshold` | `0` | Fold groups bigger than this into `<details>` |
| `max-per-group` | `0` | Cap each group (`0`: no cap) |
| `min-group-size` | `1` | Fold smaller groups into "Others" |
| `topic-groups` | `40` | With `group-by: topic`, how many topics become groups |
| `pinned` | | `owner/name` list, shown first |

### Filters

| Option | |
| --- | --- |
| `exclude-archived`, `exclude-forks`, `exclude-own` | `true` to leave them out |
| `min-stars` | Leave out smaller repositories |
| `include` / `exclude` | Globs on `owner/name` (`vercel/*`, `*/awesome-*`) |
| `exclude-topics`, `languages` | Topic deny list, language allow list |

### Run

| Option | Default | |
| --- | --- | --- |
| `token` | `github.token` | Read stars, commit |
| `commit` | `true` | `false` writes the files only, for a later step (a PR, Pages…) |
| `dry-run` | `false` | Report the changes, write nothing |
| `branch` | current branch | |
| `message` | `chore: update starred repositories` | |
| `config` | `.github/starsmith.yml` | |

### AI

| Option | Default |
| --- | --- |
| `ai` | `false` |
| `ai-provider`, `ai-model`, `ai-api-key`, `ai-base-url` | see [Providers](#providers) |
| `ai-features` | `categorize,describe,digest` |
| `ai-language` | `locale` |
| `ai-categories` | derived once by the model |
| `ai-batch-size` | `40` repositories per call |
| `ai-max-calls` | `60` per run |
| `ai-min-interval-ms` | `4500` on GitHub Models, else `0` |
| `ai-sample-size` | `150` repositories to derive the categories |
| `ai-digest-days` | `30` |
| `ai-min-coverage` | `0.9` |
| `ai-refresh` | `false`: `true` derives the categories and digest again |

### Outputs

`changed`, `total`, `new-stars`, `group-by` (the one used), `files`, `commit-sha`.

## Config file

```yaml
# .github/starsmith.yml
title: My stars
group-by: ai-category
ai: true
ai-categories:
  - Web Frameworks
  - CLI Tools
  - Machine Learning
pinned:
  - vercel/next.js
overrides:
  some/repo:
    category: CLI Tools
    description: My own words about it
  noisy/repo:
    hide: true
```

`overrides` exists only in the file: it sets a repository's category or description, or hides it.

## Run it locally

```bash
bun install
bun run build
GITHUB_TOKEN=$(gh auth token) node dist/index.js --username octocat --workspace /tmp/stars --commit false
```

Every option works as a flag (`--group-by topic`, `--no-stats`, `--dry-run`).

## Development

```bash
bun run lint && bun run typecheck && bun test
bun run build   # dist/index.js, committed: CI fails when it is out of date
```

To release, publish a GitHub release `vX.Y.Z`: the `v1` tag moves to it.

## License

[MIT](LICENSE)
