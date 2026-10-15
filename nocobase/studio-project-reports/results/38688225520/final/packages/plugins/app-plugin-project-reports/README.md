# Project reports

Daily project progress, rather than a list of commits. The plugin schedules runs through the existing Scheduler and Agents plugins, stores facts separately from summaries, and contributes `/project-reports` to the application navigation. Studio keeps its existing Dashboard unchanged.

## Ownership and dependencies

The plugin directly consumes Projects, Scheduler and Agents. It never imports Studio code, reads Studio Git tables, requests Studio Git tokens or changes a project's issues. A report run is its own `project-report` subject, not a development issue. The project supplies repository URLs and refs; the runner supplies its own Git/SSH configuration. Do not put credentials in repository URLs.

The application's normal plugin registration and existing `reports` page grant are the only UI integration. Components and theme tokens follow Studio. A subject may declare an optional `actionCeiling`; report subjects use an empty business-action ceiling and retain only run-self commands and the universal agent directory. Other subjects are unchanged.

## Use

Open **Project reports**, choose a project and expand **Report settings**. Choose an enabled runner agent, timezone, local hour and summary language, then enable daily generation. Saving records the person responsible for scheduled runs. Their current project and issue permissions are checked again before dispatch, claim and result acceptance.

The dispatcher checks every minute, starting after the configured local hour for the previous complete calendar day. Repeated firings produce one report for a project, date and timezone. A report may also be requested for an earlier day. There are at most two report runs active at once, at lower priority than development work. Unavailable runners leave a visible pending report; a six-hour wait fails rather than silently becoming zero activity.

The runner uses a separate read-only work directory. It receives a versioned collector and immutable material as a mount. The collector computes numeric facts; the agent groups changes into feature, architecture, important-fix, ordinary-fix, maintenance and risk items. Each item must cite an issue or commit in that material. The runner submits facts with `<cli> report facts --file facts.json`, then a schema-validated summary with `<cli> report publish --file summary.json`. Its final chat message is not treated as the report.

Run-self APIs authenticate a live run credential and match the exact run, attempt, owner and current report. A user session or a run on another subject cannot publish. Accepted facts cannot be replaced. Regeneration creates a new attempt and retains the previous published result until replacement succeeds.

## Metric definitions

- **Source lines:** two pinned target-branch snapshots, via Git `diff --numstat`. Tests, documentation, configuration and generated files/lockfiles are separate categories. This is a snapshot delta, not the sum of every commit's churn, and not a productivity score.
- **Historical boundaries:** when Git is the only source, commit timestamps estimate the boundary; they do not prove when code reached a remote branch. This limitation is displayed. A contiguous prior report's head is reused as the next base; both SHAs and the UTC half-open window are saved. Rewritten history fails visibly instead of silently comparing unrelated trees.
- **Tests:** compare inventories when `.nocobase/report-tests.json` is available at both versions. The optional file is `{ "version": 1, "suite": "unit", "tests": ["stable-id-1", "stable-id-2"] }`, a complete inventory for the same suite, with unique IDs. The collector does not execute repository code. Without an inventory it may estimate literal JS/TS `test`/`it` declarations, explicitly labeled as estimates. Dynamic/parameterized or unsupported discovery is unavailable, not zero. Renames are normalized; other renames of test identity count as removal plus addition. Multiple test frameworks or browser executions need a normalized inventory to be compared accurately.
- **Issues:** created, entered `done`, entered `cancelled`, and reopened from a terminal status during the window. Each issue counts once per event kind; the four metrics overlap and must not be added as unique deliveries. Queries respect current visibility; deleted issues and issues moved to another project are not a complete historical audit. The summary evidence list is bounded, with truncation disclosed.
- **Delivery:** a commit on the selected branch does not prove deployment or a passing test run. The summary schema intentionally has no `published` or `deployed` stage.

Unknown collection results remain null; charts show gaps. A failed repository does not become a zero-value day. The overview does not sum source lines across projects, because projects may share a repository. Select a project to view its trend.

## Storage and lifecycle

`projectReportSettings` keeps project scheduling. `projectDailyReports` identifies a project/day/timezone and points to the current and published attempts. `projectReportAttempts` stores the immutable material, facts, summary, run, state and failure. Old published content survives a failed regeneration. `projectReportLocks` serializes dispatch across application instances; occurrence idempotency alone is not enough.

No report configuration is enabled by installation. Removing the client/server plugin registrations disables the feature; no development workflow or Issue trigger is changed. Historical records are retained. Scheduler deployment must use the appropriate jobs backend for the application's instance topology.

## Security boundary

The report APIs enforce project and issue visibility and require project management for generation/configuration. Runner facts are trusted output of an authorized runner, validated for structure and provenance references; validation does not mathematically prove that a machine executed the collector unchanged. Read-only workspaces and command ceilings are not operating-system sandboxes. Use a suitably isolated runner with least-privilege Git credentials. Repository text and commit messages are untrusted input to the summary agent.

No repository setup script, package installation, test suite, remote commit, PR, issue mutation or deployment is part of report generation. The collector invokes Git without a shell, rejects embedded credential URLs and local/file remotes, disables hooks and external diff drivers, bounds output and redacts command failures.

## Verification

Run the plugin's `typecheck`, `test`, `lint` and `build`, Projects tests for the daily event query, Agents tests for the action ceiling, and Studio integration/browser checks. The Node collector tests build a real Git fixture; they do not substitute for testing the entire report flow.
