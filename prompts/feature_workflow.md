# Prompt: Generate Feature (BD → Figma → Scala → Svelte)

## Goal
Build a **new feature** on the REZIL stack from design docs, end-to-end up to PR. Design-first,
testcase-first, contract-first. Correctness over creativity. Never invent API/field/rule/UI — when
information is missing, record an **Assumption** or hit the INFO GATE. Stop at PR; never merge/deploy.

This is the **Feature** workflow. For a quick bug fix / small change, use `prompts/fix_bug.md` instead.

## Input
- Jira ticket key (e.g. REZIL-XXXX) — read it and its remote links (`getJiraIssueRemoteIssueLinks`) for BD/Figma.
- BD + Figma **context**: pasted BD text, Figma link(s), or repo-relative path(s) to a BD doc.
  Headless: you cannot open an auth-gated Figma file — use pasted text / fetchable links / screenshots only.
- Repo(s): `rezil-esms` (full-stack) / `rezil-esms-lib` (shared Scala) / `rezil-esms-mobile`.

## Artifacts
Write each phase's output to `.ai-agent/generated/NN-*.md` in the target repo working tree as the audit
trail (the substitute for human phase-gates). Keep them **git-ignored** (add `.ai-agent/` to
`.git/info/exclude` at the start of the run) — do NOT commit them. The PR body carries only a digest.

## Steps (16 phases)
1. **Intake** — summarize the request; identify affected layers (LIB/BE/FE/OpenAPI/Test) and repo(s); list inputs to read; note missing info. → `00-task-intake.md`.
2. **Read BD** — extract feature, screens, user flow, input/output fields, business rules, validation, error cases, permissions, API candidates, data model. Do not invent rules; missing → Assumptions. Struck-through rows are dropped spec — re-read every row you rely on with formatting (`AGENT_RULES.md` §Đọc BD). → `01-bd-analysis.md`.
3. **Extract structured spec** — requirement IDs (REQ-xxx), owner layer per rule, layer classification (LIB/BE/FE/OpenAPI), traceability matrix BD→Test→Code. → `02-structured-spec.md`.
4. **Generate UT cases** — UT for LIB (domain/validation/mapper), BE (service/controller/mapping/error), FE (render/form/state). Normal + boundary + invalid + empty + permission + error. Each traces to a REQ. → `03-ut-testcases.md`.
5. **Select IT cases** — pick UT that need multi-layer / API-contract / BE+DB / FE+API / permission coverage; record reason + what was not selected. → `04-it-testcases.md`.
6. **Read Figma** — screens, components, fields, buttons, labels, error/empty/loading/disabled states, interactions. Do not invent UI; missing states → Assumptions. → `05-figma-analysis.md`.
7. **Map BD ↔ Figma** — map fields/actions/validation/state across BD↔UI↔API; flag mismatches. BD wins on business rule, Figma wins on layout; behavior conflict → Assumption (non-interactive). → `06-bd-figma-mapping.md`.
8. **OpenAPI contract** — check existing endpoints; create/update path + request/response/error schema matching BD + project convention. Changing the contract obliges updating BE, FE, Aspida and tests. → `07-openapi-plan.md` + `openapi.yaml`.
9. **Aspida client** — regenerate the typed client from OpenAPI via the project command; never hand-edit generated files; list FE impact. If generation fails: report command + error, do not proceed to FE. → `08-aspida-report.md`.
10. **Scala LIB** — domain model / shared validation / business rule / mapper / error types in `rezil-esms-lib` (or the repo's lib module); no BE-framework dependency; write/update LIB UT. → `09-lib-implementation-plan.md`.
11. **Scala BE** — endpoint/controller/service/repository per OpenAPI; reuse LIB for domain logic; request/response mapping; error handling + permission per convention; update BE UT. → `10-be-implementation-plan.md`.
12. **Svelte FE** — page/component/store per Figma + mapping; call API via the Aspida client (no hardcoded URLs/fetch); loading/error/empty states; client validation where needed; update FE UT. → `11-fe-implementation-plan.md`.
13. **UT impl + run** — implement/run UT per module (`sbt test`, FE unit tests). Record results; analyze + fix failures; never delete a failing test to go green. → `12-ut-result.md`.
14. **IT impl + run** — implement/run the selected IT (API contract, happy path, key error paths, permission). Record results. → `13-it-result.md`.
15. **Build / Lint / Typecheck** — BE `sbt scalafmtCheckAll "scalafix --check"` + `sbt compile`; FE `npm run check` + `npm run build`; regen Aspida; `./semgrep-rules/scan.sh`. Any failure → stop, report, do NOT open PR. → `14-quality-check.md`.
16. **Review diff** — scope, stray files, OpenAPI/BE/FE alignment, FE↔Figma, test coverage, security, breaking changes, hallucinated API. → `15-review-summary.md`.
17. **PR / ticket update** — per affected repo: push branch `<type>/YYYY-MM-REZIL-XXXX-<SCREEN-CODE>` bằng `git push -u origin HEAD` (KHÔNG `git push` trống — nhánh mới chưa có upstream, dễ đẩy nhầm lên `develop`), base `develop`; open PR (title `[<phase>] <SCREEN-CODE> | REZIL-XXXX - <summary>`, body = `templates/pr_template.md` + Changes/Tests/Risk/Assumptions digest). Cross-link multi-repo PRs. Comment Jira with PR link(s) as markdown links + scope. → `16-pr.md`.

## Multi-repo
A LIB+BE feature produces a branch + PR in **both** `rezil-esms-lib` and `rezil-esms`. Land LIB first if BE
depends on it; cross-link the PRs. Single-repo when the change is single-repo.

## Sub-agents
This workflow may delegate per-phase work via the Task tool (a phase = a sub-agent) to keep context small.
The orchestrator owns the phase artifacts and the final PR. REZIL repos do not ship `.claude/agents/`, so
sub-agents follow the role/scope descriptions in this prompt, not pre-registered named agents.

## Guardrails
- **Never** invent API/field/business rule/UI — missing info → Assumption or `⛔ NEED-INFO:`.
- **Never** change OpenAPI without updating BE + FE + Aspida + tests.
- **Never** hardcode an API URL/fetch in FE when Aspida exists.
- **Never** put domain/business rule in a controller if LIB should own it.
- **Never** merge, deploy, touch secrets/CI. **Never force-push `develop`/`main`** (force-push nhánh feature của mình được nếu cần).
- Non-interactive: do not ask the user; state Assumptions and proceed (unless the INFO GATE triggers).

## Output
- Branch(es) + PR link(s) (per affected repo).
- Phase artifacts under `.ai-agent/generated/` (git-ignored).
- Summary: requirement coverage, test/build/quality results, risks, and Assumptions.
