# AI Agent — rezil-esms

A safe, Jira-driven AI coding workflow for the **rezil-esms** monorepos. The agent reads a Jira
ticket, makes a minimal change, runs the quality gates, opens a PR, and updates Jira — then **stops**.
It never merges and never deploys.

---

## 0. Prerequisites & setup

The agent drives the **Claude Code CLI** (`claude`) plus `git` / `gh`, and talks to Jira through an
**Atlassian MCP server**. Set these up once before the Quick start.

### 0.1 Required tools

| Tool                     | Min version      | Check              | Notes                                                        |
|--------------------------|------------------|--------------------|--------------------------------------------------------------|
| Node.js                  | ≥ 20 (tested 24) | `node -v`          | runs the scripts + the `ui-next` web UI                      |
| Git                      | any recent       | `git --version`    |                                                              |
| GitHub CLI `gh`          | ≥ 2.4            | `gh --version`     | used to open PRs                                             |
| Claude Code CLI `claude` | ≥ 2.x            | `claude --version` | **must be on `PATH` as `claude`** — the UI spawns it by name |

### 0.2 Install + log in to the Claude CLI

```bash
# Install (either one):
npm install -g @anthropic-ai/claude-code           # via npm
# or the native installer:  curl -fsSL https://claude.ai/install.sh | bash

claude            # first run prompts login; or run /login inside the CLI
```

Logging in writes `~/.claude/.credentials.json` (OAuth token) — the same file the UI's `/usage`
panel reads to show live rate-limit usage. Confirm with `claude --version` and `which claude`.

### 0.3 Authenticate GitHub

```bash
gh auth login          # pick GitHub.com → HTTPS → login with browser
gh auth status         # verify
```

### 0.4 Connect the Atlassian MCP (Jira)

Auto mode reads/updates Jira via the `mcp__atlassian__*` tools, which come from the Atlassian
**remote MCP** server. Register it with the Claude CLI once (OAuth opens in the browser):

```bash
claude mcp add --transport http atlassian https://mcp.atlassian.com/v1/mcp
claude mcp list        # should show:  atlassian: https://mcp.atlassian.com/v1/mcp (HTTP) - ✔ Connected
```

> Only the `atlassian` server is required for this agent. (Other MCP servers you may have — mysql,
> gsheets, Figma — are unrelated to the ticket→PR workflow.)

### 0.5 Clone the target repos

The agent edits the real repos at the paths declared in `config/github.json`. Clone them there
(default layout — adjust the paths in `github.json` if yours differ):

```bash
# example for the default layout under ~/IdeaProjects
git clone https://github.com/hybrid-tech-rezil/rezil-esms.git        ~/IdeaProjects/rezil-esms
git clone https://github.com/hybrid-tech-rezil/rezil-esms-lib.git    ~/IdeaProjects/rezil-esms-lib
git clone https://github.com/hybrid-tech-rezil/rezil-esms-mobile.git ~/IdeaProjects/rezil-esms-mobile
```

A repo whose path is missing is simply skipped; the run fails fast if the **selected** repo's path
does not exist.

### 0.6 Web UI (optional)

```bash
cd ui-next
cp .env.example .env          # set UI_BASIC_AUTH="user:pass" (required if you expose it via ngrok)
npm install
npm run build && npm run start   # http://127.0.0.1:5000
```

See [§8](#8-web-ui-auto-mode) for the UI features and `ui-next/README.md` for pm2 / ngrok details.

---

## 1. Quick start

```bash
# 1. Start work on a ticket (sync base + create the branch)
node scripts/fix-ticket.js REZIL-2352 ISSUE-001 --issue-type="Bug"

# 2. ...implement the change in the repo, then run the quality gates (see §4)...

# 3. Open the PR (pushes branch, fills template, base = develop)
node scripts/create-pr.js REZIL-2352 ISSUE-001 --summary="Fix duplicate rows on issue list"

# 4. Render the Jira comment to post (PR link + scope)
node scripts/update-jira.js REZIL-2352 comment \
  --pr=https://github.com/hybrid-tech-rezil/rezil-esms/pull/1300 --scope=ISSUE-001
```

Add `--dry-run` to any script to preview the commands without executing.

---

## 2. Project layout

| Path                  | What                                                                                    |
|-----------------------|-----------------------------------------------------------------------------------------|
| `CLAUDE.md`           | Role, core rules, workflow, full structure                                              |
| `WORKFLOW.md`         | The 12-step ticket workflow                                                             |
| `WORKFLOW_FEATURE.md` | The 16-phase **Feature** workflow (BD + Figma → Scala/Svelte → PR)                      |
| `AGENT_RULES.md`      | Allowed / forbidden actions, failure policy                                             |
| `TOOLS.md`            | Tools the agent may use                                                                 |
| `MEMORY.md`           | Index of long-term knowledge in `memory/`                                               |
| `config/`             | `jira.json`, `github.json`, `project.json`, `story.json`                                |
| `prompts/`            | Task prompts: `fix_bug`, `feature_workflow`, `create_pr`, `update_jira`, `transition_assign`, `review_pr` |
| `memory/`             | `architecture`, `coding_style`, `database`, `deployment`, `common_bugs`, `jira_history` |
| `scripts/`            | `fix-ticket`, `create-pr`, `update-jira` (+ `_lib` helpers), `share-projects.sh`         |
| `templates/`          | `pr_template`, `jira_comment`, `commit_message`                                         |
| `ui-next/`            | Next.js web UI (auto mode + chat) — see [§8](#8-web-ui-auto-mode)                       |

---

## 3. Configuration (`config/`)

- **`github.json`** — org `hybrid-tech-rezil`, 3 repos (`rezil-esms` default, `-lib`, `-mobile`),
  base branch `develop`, branch rule, `neverMerge` / `neverForcePush`.
- **`jira.json`** — site / cloudId / project `REZIL`, plus **`branchTypeByIssueType`** (issue type → branch type).
- **`project.json`** — product metadata, stack, repo list, DB environments.
- **`story.json`** — the secondary "story" project the UI can target (path, remote, base branch,
  branch types) for non-Jira free-form tasks. Used by Auto Story / Chat-Story in `ui-next/`.

All four contain only public identifiers — no secrets.

---

## 4. Conventions (verified against the repo)

**Branch** — `<type>/YYYY-MM-REZIL-XXXX-<SCREEN-CODE>`
- `type` is auto-mapped from the Jira issue type: `Bug→bug`, `RoC→roc`, `Task/Story/Epic→feature`, `Technical Stuff→feat`, `QA→fix` (default `fix`). Override with `--type=`.
- e.g. `bug/2026-06-REZIL-2352-ISSUE-001`

**Commit** — `REZIL-XXXX - <summary>` (imperative, English; no conventional-commits prefix).

**PR title** — `[<phase>] <SCREEN-CODE> | REZIL-XXXX - <summary>`
- phase: lấy từ tag `[...]` đầu summary ticket (vd `[PreUAT-MVP2-B]`); không có tag → `UAT-MVP2-B`
- e.g. `[PreUAT-MVP2-B] ISSUE-001 | REZIL-2352 - Fix duplicate rows`

**Quality gates (must pass before PR)**
- Backend: `sbt scalafmtCheckAll "scalafix --check"`
- Frontend: `npm run check`
- Security: `./semgrep-rules/scan.sh`
- If any fail → stop, report, do **not** open the PR.

**Jira comment** (`templates/jira_comment.md`)
```
PR: <pr-url>
Phạm vi ảnh hưởng: <SCREEN-CODE>
```

---

## 5. Scripts

| Script           | Purpose                                                             | Usage                                                                        |
|------------------|---------------------------------------------------------------------|------------------------------------------------------------------------------|
| `fix-ticket.js`  | Sync base + create the work branch                                  | `<REZIL-XXXX> <SCREEN-CODE> [repo] --issue-type="Bug" [--type=] [--dry-run]` |
| `create-pr.js`   | Push branch + open PR (base `develop`, body from template)          | `<REZIL-XXXX> <SCREEN-CODE> [repo] --summary="..." [--dry-run]`              |
| `update-jira.js` | Render the Jira comment to post (applied via Atlassian integration) | `<REZIL-XXXX> comment --pr=<url> --scope=<SCREEN-CODE>`                      |
| `share-projects.sh` | Share Claude session dirs between two accounts via symlink (see §9) | `./scripts/share-projects.sh` (dry-run) · `... go` (apply)                |

Scripts read `config/*.json`, shell out to `git`/`gh`, and enforce the guardrails (never force-push `develop`/`main`, refuse to PR from the base branch). Jira **writes** are performed by the agent via the Atlassian integration, not by the script.

---

## 6. Guardrails (hard rules)

- Never merge PRs · never force-push `develop`/`main` · never modify secrets.
- **Never deploy** (any env) — deploy is out of scope; all releases are human-driven per `RELEASE_FLOW.md`.
- Never change infra / CI/CD without explicit approval.
- Stop and ask if requirements are ambiguous.
- Keep changes small; reuse existing patterns; no unrelated refactor.

---

## 7. Workflow summary

**Fix-Bug** (`WORKFLOW.md`) — a bug fix / small change:
```
Read Jira → Sync develop → Create branch → Analyze → Implement
  → Quality gates (scalafmt/scalafix, npm check, semgrep) → Tests → Build
  → Commit → Push → Create PR → Update Jira → STOP (human reviews & merges)
```

**Feature** (`WORKFLOW_FEATURE.md`) — a new feature from design docs (16 phases):
```
BD + Figma → Spec → UT → IT → OpenAPI → Aspida → Scala LIB → Scala BE → Svelte FE
  → Test → Build/Lint → Review → Create PR(s) → Update Jira → STOP (human reviews & merges)
```

See `WORKFLOW.md` / `WORKFLOW_FEATURE.md` for the full step lists and `CLAUDE.md` for the role definition.

---

## 8. Web UI

A browser UI (**Next.js + React + Tailwind**, in `ui-next/`) to hand a ticket/task to Claude, which
**implements it end-to-end up to creating the PR**. Dark/light theme, responsive, Vietnamese.

Every surface (`/auto`, `/feature`, `/story`, `/chat`, `/release`, `/translate`) is the **same console shell** — a
header, a streaming conversation log, and a composer at the bottom. They differ only by what the
composer collects (ticket+repo / free task / chat input) and whether edits are allowed.

```bash
cd ui-next
npm install                  # first time
npm run build && npm run start   # http://127.0.0.1:5000
# or via pm2:  pm2 start ecosystem.config.js   (chỉ Next app; ngrok do ~/IdeaProjects/gateway lo — xem CADDY.md)
```

The REZIL coding workflows — pick by task type:

- **Auto / Fix-Bug** (`/auto`): enter the **Jira ticket** and pick the **repo**; submit. The server runs
  `claude -p --permission-mode auto` in that repo and **streams progress** live (in Vietnamese): it
  reads the ticket (deriving issue type + screen code), creates the branch, makes a **minimal fix**, runs
  the quality gates, commits, pushes, opens the PR, and comments Jira. See `WORKFLOW.md`.
- **Feature** (`/feature`): enter the **Jira ticket**, pick the **primary repo**, and paste **BD + Figma
  context** (text, links, or repo-relative BD paths). Runs the full **16-phase** design→code workflow
  (BD → spec → UT/IT → OpenAPI/Aspida → Scala LIB/BE → Svelte FE → test → review → PR). Per-phase
  artifacts are written to `.ai-agent/generated/` (**git-ignored**, audit trail only); a LIB+BE feature
  may open a PR in **both** `rezil-esms` and `rezil-esms-lib`. It's a **long job** (tens of minutes) and
  shares the per-repo job lock with Auto. See `WORKFLOW_FEATURE.md`.
- **Auto Story** (`/story`): free-form task → branch `fix|feature/YYYY-MM-<desc>` → PR to `develop`
  (no Jira; uses the story repo's own agents).
- **Info gate**: if the ticket/task lacks enough info, Claude stops and prints `⛔ NEED-INFO:`
  (no changes) — the UI shows a banner so you can Cancel.
- **Concurrency per repo**: one job per repo at a time; a second job on the **same repo** returns `409`.
- **Hard limits**: never merge, never deploy, never force-push `develop`/`main` (force-push of your own
  feature/fix branch is allowed; the ban on `develop`/`main` is enforced via the system prompt).
  Non-interactive — it states assumptions and proceeds.
- Binds **127.0.0.1 only**; **Basic Auth** via `ui-next/.env` `UI_BASIC_AUTH` (needed when exposed via ngrok).
- ⚠️ Auto mode makes **real changes** to the selected repo and opens a **real PR**. Review before merging.

### Translate (`/translate`)
A multi-turn console that compares a **Vietnamese document against its Japanese translation** on Google
Sheets and reports every mismatch, cell by cell, for the BSE to fix. Read-only by default.

- **8 file pairs are pre-registered** in `ui-next/lib/translate.js` → `TRANSLATE_PAIRS`: `web`,
  `mobile`, `batch`, `portal` (Basic Design), `offline` (online/offline behaviour matrix),
  `masterdata` + `address` (enum / master data), `testcase` (SQA test cases). Type the keyword instead
  of pasting links; pasting other Sheet links still works.
- **Findings are typed** `T1` not translated · `T2` Vietnamese left in the JP file · `T3` VN copied
  verbatim · `T4` placeholder/number/code mismatch · `T5` suspected mistranslation (judgement, always
  with a reason + suggested wording) · `T6` extra in JP · `T7` structural mismatch. Field names,
  Spec-IDs, English section headings and Figma links are **not** counted as untranslated.
- **Report format is written for the BSE**: 6 columns `Ô VN | Ô JP | Loại | Nội dung VN | Nội dung JP |
  Cần sửa`, cell addresses spelled `<tab>!<cell>` and both sides quoted verbatim, so they can open the
  Sheet and fix in place. Sweeping a whole file prints a plan first, then runs in batches of 3–5 tabs.
- **Writing the report** (only when you ask): appends to the shared checklist spreadsheet
  `1zfkfhP016v4IkaqZ1gXH14OS33buRATvEnTdcQn33PI`, tab `ChecklistAI` — **one row per mismatch**, where
  `LINK VN`/`LINK JP` point straight at the offending cell (`…#gid=<gid>&range=<cell>`) so no separate
  address column is needed, `Update` is always left `FALSE` for the BSE to tick, and the `gid` is
  looked up from the `Checklist` tab, never invented. Append-only; the source VN/JP tabs are never modified.
- **Already-scanned tabs are remembered** in `ui-next/data/translate-scan-state.json` (git-ignored) via
  `ui-next/scripts/translate-state.mjs` — the agent lists it before planning and skips those tabs, and
  records each tab right after scanning it. It rescans only when you name that tab or say "soát lại".
- All rules live in `ui-next/app/translate/TRANSLATE_SPEC.md`, **read at runtime** — editing the spec
  changes behaviour on the next turn, no build/restart needed.
- Needs the service account `rezil-agent@rezil-agent.iam.gserviceaccount.com` shared on each file
  (Viewer to compare, Editor on the checklist file to write). A 403 stops the agent with that message.

### Chat (`/chat`)
A Q&A console — open per project from Home (REZIL → `/chat?project=rezil`, Story → `?project=story`;
each keeps its own saved conversation + session). Ask about code or tickets, answers stream in
Vietnamese. Type `/usage` to see token usage + estimated cost. Multi-turn (session resume).
- **Read-only by default**: Read/Grep code, search the web, read Jira — no edits.
- **✏️ Sửa code toggle**: tick it to let the chat edit files and run build/test (`Edit`/`Write`/`Bash`).
  Same hard limits apply — never merge, never deploy, never force-push `develop`/`main`. Leave it off for plain Q&A.
- ⚠️ With the toggle on, the chat edits the **default repo's working tree** on its current branch
  (no auto branch/commit) — use it for quick iterative changes, not the full ticket workflow (use Auto for that).
- **Runs out of quota? The chat keeps going on another account** — same session, no clicks. See §9.

### Release (`/release`)
A multi-turn console that drives the **`github-ops`** agent (gh CLI) to run the release flow for the
rezil repos — promote a DEV1 PR, create releases/tags, watch CI. Just describe the op in Vietnamese
(e.g. *"Release DEV1 rezil-esms"*, *"list PR đang mở"*, *"check CI run mới nhất"*); progress streams live.
- Spawns `claude -p --agent github-ops --permission-mode bypassPermissions` (mirrors `lib/release.js`).
- **Confirm-before-write**: per `github-ops.md`, every write action (merge / create release-tag / trigger
  workflow) stops and asks; you approve in the **next turn** (session resume) before it runs.
- **DEV1 only — STG is refused.** Backup of the base branch happens before any promote/merge; the
  server injects the current timestamp for the backup-branch name.
- **Release MAY merge** the DEV1 promote PR (that's the flow) — so unlike Auto/Chat it is *not* blocked
  from merging. Everything destructive stays blocked via `disallowedTools`: delete push, history
  rewrite (`reset --hard`/`rebase`/`clean`), repo settings & deletion, `gh release delete`, CI secrets,
  `gh auth`/`git config`, `rm`/`sudo`, and code edits (`Edit`/`Write`). See `lib/release.js`.
- **Evidence sau deploy**: tạo folder `dd／MM Deploy <Env> UAT <Phase>` trong Drive folder
  `16lz2OJe1oaNtmx_t3H4uk1hMlbbKiLLY` → subfolder `DEV1`/`STG` → upload `lib/admin/mobile/portal.png` từ
  `~/deploy-evidence/<dd-MM>/<ENV>/` bằng `rclone` remote `gdrive-rezil` → ghi link vào ô `J32`/`J34` của tab
  deploy `dd/mm`. Xem §Evidence Folder trên Google Drive trong `github-ops.md` / `RELEASE_FLOW.md`.
- **Chụp ảnh evidence**: `scripts/capture-ci-evidence.sh` — headless Chrome chụp trang GitHub Actions của từng
  repo (filter theo tag đợt) vào `~/deploy-evidence/<dd-MM>/<ENV>/`. Chạy `... login` một lần để tạo profile
  Chrome riêng có session GitHub; script tự dừng nếu CI chưa xanh hết hoặc session hết hạn.
- ⚠️ Acts on **real GitHub repos**. Review each confirm prompt before approving.


---

## 9. Multiple Claude accounts (quota fallback)

Several Claude accounts can live on one box — each is its own `CLAUDE_CONFIG_DIR` holding separate
credentials **and** separate session transcripts. Registered in `ui-next/lib/config.js`:

| Key | Config dir | Note |
|-----|------------|------|
| `acct1` | `~/.claude` | default account — `CLAUDE_CONFIG_DIR` must stay **UNSET** (the real config is `~/.claude.json`, not `~/.claude/.claude.json`) |
| `acct2` | `~/.claude-account2` | re-enabled 2026-08-19 (was disabled 2026-08-17 while the org subscription was off) |
| `acct3` | `~/.claude-account3` | |

Adding one is a single entry in `ACCOUNTS`.

### Share session dirs (do this once per cwd)

A session is `<CLAUDE_CONFIG_DIR>/projects/<cwd-with-/-and-.-replaced-by->/<session-id>.jsonl`, so an
account can only resume a session whose file it can see. `scripts/share-projects.sh` makes the main
account own the real directories and points the other account at them with symlinks:

```bash
./scripts/share-projects.sh        # dry-run: prints what it would do
./scripts/share-projects.sh go     # apply

# One run per secondary account (CLAUDE_ALT_DIR defaults to ~/.claude-account3):
CLAUDE_ALT_DIR=~/.claude-account2 ./scripts/share-projects.sh go
```

Idempotent — re-run it after working in a new cwd to add the missing symlink. Sessions that only the
alt account had are moved over (never overwritten); a real `memory/` dir is moved, a redundant
`memory` symlink is dropped. Override the pair with `CLAUDE_MAIN_DIR` / `CLAUDE_ALT_DIR`.

**Never symlink `.credentials.json`** — that file *is* the account identity. `todos/` and
`file-history/` (`/rewind`) stay per-account by design.

### Automatic fallback in `/chat`, `/release`, `/evidence`, `/kloc`, `/translate`, `/investigate`

When the pm2 account runs out of quota, those consoles run the next turn on the account with the
most quota left, on the **same session**, and prints one line (`⚠️ acct1 hết quota … chuyển sang acct3`).
Fail-open: if quota can't be read or the transcript can't be synced, it stays on the current account.
Two non-quota failures also switch, since staying put would fail every turn: the account lost its
login (access + refresh token both expired), or the org disabled Claude Code for it (`Your
organization has disabled Claude subscription access for Claude Code`) — the latter never resets on
its own, so it is remembered for the process lifetime instead of the 60s quota cache. Both are only
visible once the run has died, so the failed run is **re-spawned on another account inside the same
turn** (up to 3 spawns) instead of costing the user a turn.
Only `/chat`, `/release`, `/evidence`, `/kloc` and `/investigate` do this — the remaining job consoles
(`/auto`, `/feature`, `/rebase`, `/report`) still use the pm2 account. Details in `ui-next/README.md`.

### Manual handoff from a terminal

`~/claude-backups/handoff-session.sh -x 1 3` copies the newest session of the current project to
account 3 and opens it there (`-n` dry-run, `-f` overwrite). Not needed for dirs already symlinked.
