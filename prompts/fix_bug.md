# Prompt: Fix Bug

## Goal
Fix a bug from a Jira ticket with a safe, minimal change. Correctness over creativity.

## Input
- Jira ticket key (e.g. REZIL-XXXX)
- Repo (default `rezil-esms`; also `rezil-esms-lib`, `rezil-esms-mobile`)
- Reproduction steps / expected vs actual

## Steps
1. **Read Jira** ticket; confirm requirement. Stop & ask if ambiguous. If the fix depends on BD, read the rows you rely on with formatting — struck-through rows are dropped spec (`AGENT_RULES.md` §Đọc BD).
2. **Sync** base: `git checkout develop && git pull`.
3. **Branch**: `git switch -c <type>/YYYY-MM-REZIL-XXXX-<SCREEN-CODE>` **trước khi sửa file** — `type` auto-mapped from Jira issue type (Bug→`bug`, RoC→`roc`, Task→`feature`...; see config/jira.json). E.g. `bug/2026-06-REZIL-2352-ISSUE-001`.
4. **Locate root cause** — trace LIB (domain/validation/business rule/mapper in `rezil-esms-lib`) → BE Scala (controller/route → service → repository) → FE Svelte (component → store → api). Domain/business rules live in LIB, not in controllers — if the root cause is a domain/validation rule, fix it in LIB. A fix touching LIB + BE may need a PR in **both** `rezil-esms-lib` and `rezil-esms` (land LIB first, cross-link).
5. **Implement** the minimal fix. Reuse existing patterns; no unrelated refactor.
   - **Migration (nếu có schema/data change)**: theo `templates/migration.md` — sinh file bằng `./etc/scripts/new-migration.sh <db> <folder> "<desc>"` (`db`=`esms`/`inspection`, `folder`=`common`/`env-*`), tên `V<YYYYMMDDHHMMSS>__<desc>.sql`. KHÔNG gõ tay version, KHÔNG sửa file migration đã apply.
6. **Code quality** (must pass):
   - BE: `sbt scalafmtCheckAll "scalafix --check"`
   - FE: `npm run check`
7. **Tests + build**. If anything fails → stop, report, do NOT open PR.
8. **Security**: `./semgrep-rules/scan.sh`.
9. **Commit**: `REZIL-XXXX - <summary>` (see templates/commit_message.md). Verify `git branch --show-current` ≠ `develop` trước khi commit.
10. **Push**: `git push -u origin HEAD` (KHÔNG `git push` trống — nhánh mới chưa có upstream, dễ đẩy nhầm lên `develop`), rồi open PR (templates/pr_template.md). Never merge.
11. **Update Jira** (templates/jira_comment.md).

## Output
- Branch + PR link
- Root cause + fix summary
- Test/build/quality results
