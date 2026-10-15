# Project reports implementation review

## Delivery status

The source tree in this archive is a tested candidate for `nocobase/nocobase` at base `98b386237a9fabcb7a86c47b4a46c4980c1d3e13`. It is not the current remote feature branch. The remote `feat/v3-project-reports` still contains an earlier partial implementation; no pull request was opened. The delivery bundle makes the tested candidate a fast-forward commit on that same branch, without another remote branch or a source workflow. Local shell execution and browser-based transfer of the large generated lockfile were unavailable during the session. These are delivery limitations, not evidence that the remote branch passed the checks below.

## Product and architecture

The independent package `@nocobase/app-plugin-project-reports` owns report scheduling, run orchestration, immutable source material, collector facts, summary publication, history and the React page. Studio registers the client/server plugin, its dependency and the plugin's Tailwind source. It does not provide Git connections or credentials. Repositories and target refs come from the existing Projects resources. Runners use their own Git/SSH configuration and isolated read-only workspaces.

A schedule enqueues a report attempt rather than creating a development issue. The deterministic collector runs on the Runner and calculates code/test statistics; the language model produces a separate, schema-validated narrative. Facts are saved before the summary, and a failed regeneration retains the previous published report. The client reads structured data from the database. It does not render arbitrary generated HTML or calculate metrics by parsing model prose.

Two narrowly scoped existing capabilities were extended. Projects now exposes a daily event query so the new plugin does not reimplement task visibility or read its private tables. Agents supports an optional subject action ceiling, which bounds the report run's business actions independently of the human's wider permissions. Existing subjects without this option retain their prior behavior. Regression tests cover that fallback.

## Review findings addressed

**Report runs inheriting development permissions.** A read-only instruction or workspace flag alone does not prevent a run from invoking Studio business APIs as its initiating manager. The optional subject action ceiling is applied by the caller gate; report work uses an empty business-action ceiling. Current-run report endpoints separately authenticate the exact active report attempt. This is an application authorization boundary, not an operating-system sandbox.

**Duplicate scheduling and concurrent publication.** Daily report keys are idempotent. Settings use optimistic revisions, dispatch uses a database-backed lock, and publication serializes competing writes so the first accepted summary remains stable. Attempts are separate records; cancellation or failure does not delete the last published report. Tests cover duplicate creation, concurrent publication and failed regeneration.

**Unbounded report work competing with development.** The report dispatcher limits active report runs to two, uses a lower priority than development runs and expires queued attempts. One project's failure does not stop unrelated projects. This is a report-specific limit, not a new job system.

**Mutable owner permissions and forged result submission.** Project access is checked for reading, configuring, dispatching, claiming and accepting output. A different run cannot submit to another attempt; revoked manager permissions are rejected. Private-project reports are not returned to unrelated members. The initiating identity is explicit for scheduled runs.

**Invented numbers, missing evidence and incomplete collection.** Runner facts and model summaries have distinct schemas and storage. Repository identities, commit references and issue references are validated against the supplied material. Missing data is represented as unavailable, not zero. First accepted collector facts are immutable. Code categories distinguish source, tests, documentation, configuration and generated files, with binary changes separate.

**Misleading test counts.** Exact test additions/deletions require comparable inventory files. The fallback is clearly labeled static JS/TS test declarations, not executed or parameter-expanded cases. Unsupported or incomplete inventories remain unavailable. Tests exclude declarations in comments/strings and exercise a real Git history.

**Natural-day errors.** Date windows are half-open intervals calculated in the configured timezone, including daylight-saving changes. Today's unfinished date cannot be generated as a complete daily report. A prior snapshot is used when compatible; otherwise historical Git boundaries are explicitly marked as commit-time estimates.

**Settings field accessibility.** The initial browser test could not reliably locate the Agent selector because its implicit accessible label included the options. Explicit accessible names were added to the settings fields. The original browser assertions were retained and passed afterward.

## UI review

The page uses the same PageContainer, PageHeader, Button and Input component implementations and semantic theme classes as Studio, with a lazy route and localized strings. It keeps Studio's shell, base-path-aware API client and sidebar rather than introducing a separate dashboard shell. Content is ordered around meaningful project changes; critical fixes and unresolved risks receive visible treatment, minor fixes are compact, evidence is expandable, and metrics/trends are secondary.

The Chromium end-to-end test exercises the real Studio server and frontend, not a static prototype. It covers report configuration, generation, Runner protocol publication, refresh, persisted rendering, permission rejection and mobile horizontal overflow. Desktop and mobile screenshots are included. Programmatic checks do not establish subjective visual perfection, and no accessibility audit beyond the stated checks is claimed.

## Verification

See `verification.txt` for exact exit codes and `logs/` for the command output. Required scoped checks are plugin formatting, lint, type checking, build and tests; Projects and Agents type checks and their new regression tests; Studio type check and production build; Chromium end-to-end flow; changeset validation; peer/runtime dependency checks; generated CLI documentation; Studio OpenAPI validation; and frozen-lockfile installation.

The previous run recorded 18 plugin Vitest tests, four Node collector tests, one Projects daily integration test, three Agents authorization tests, and one browser end-to-end test. These are the scoped new tests, not a claim that every test in the monorepo ran. The final logs are authoritative if counts change.

The browser test uses a deterministic Runner protocol fixture to submit facts and a narrative. The collector independently exercises real local Git repositories. No production private-repository credential, paid live model, production application, or real overnight schedule firing was exercised. The scheduling and authorization logic were tested through controlled integration calls.

A prior whole-repository OpenAPI command failed only because the isolated checkout installed Studio's dependency closure, not the unchanged default/examples templates. Studio's API validation passed. The final verification scopes the API check to Studio rather than claiming those unrelated applications were tested.

## Remaining limitations and follow-up work

Git commit time is not historical branch push time. A late push, rewritten history or an unavailable prior snapshot can alter date attribution; the report keeps pinned SHAs and labels the boundary method. Target-branch code changes are not proof of production deployment or successful tests. Comprehensive unmerged PR reporting is outside this Git-only version.

Static test declarations are estimates. Repositories that need exact runtime case changes should supply comparable `.nocobase/report-tests.json` inventories. A change of counting method is not directly comparable and must remain visible to the reader.

The history endpoint bounds its rows but currently returns stored report material and narratives, not a compact trend-only projection. Large workspaces were not load-tested. Before scaling to thousands of reports in one response, add compact metric projections/pagination and measure query/response size. Shared repositories are not blindly summed into a workspace productivity number.

Historical snapshots remain project-owned records. The current project/issue viewing rules protect the report, but this review does not claim per-reference reauthorization after every later issue move or deletion. Retention and historical-data policy should be decided before exposing reports beyond project readers.

The Runner is a trusted execution environment. The business-action ceiling and read-only workspace do not isolate every filesystem, shell or network capability of a coding tool. Use appropriately trusted Runner machines and least-privilege Git credentials. Repository text is treated as evidence rather than instructions, but no claim of perfect prompt-injection resistance is made.

The collector may perform an additional isolated clone instead of reusing a development checkout. This prioritizes correctness and noninterference; a content-addressed read-only cache is a possible later optimization. No existing developer directory is cleaned or reset.

## Repository hygiene

Only `feat/v3-project-reports` was created in the source repository. Temporary verification workflows, preparation scripts, logs and screenshots remain under `gchust/temp`. The source patch contains production code, maintained tests, required documentation, a changeset and the synchronized lockfile; it changes no source workflow. No source branch was force-pushed or merged, and no PR was represented as ready while source synchronization remained incomplete.
