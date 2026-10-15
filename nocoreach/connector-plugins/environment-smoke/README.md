# NocoReach connector work: execution environment smoke test

This temporary harness checks an alternative to the unavailable ChatGPT CaaS execution environment. It runs only on a GitHub-hosted Ubuntu runner, with Node 24 and Playwright 1.62.1 (the version declared by NocoReach when this harness was prepared).

It checks Node, temporary file create/read/overwrite, a Node child process, a real loopback HTTP server, Chromium launch and HTTP navigation, browser form input and clicking, a POST persisted to a local file, reload/readback, screenshots, and browser errors. It uses `page.goto()` against the running server, not `page.setContent()`.

The browser is restricted to the probe's loopback origin. npm packages and browser binaries are downloaded only as part of environment setup. No real platform credentials, external API writes, production data, user computer, or self-hosted runner are used. The workflow has read-only repository permissions and does not persist checkout credentials.

This is **not** NocoReach application testing, connector migration, or proof that its existing integrations work. Passing this smoke test only establishes that Node + server + browser tests can execute on the replacement runner. Real NocoReach acceptance must start the actual application and exercise its real pages, using demo/mock only at the external API boundary.

Workflow: `.github/workflows/nocoreach-connector-runner-smoke.yml`. It runs manually or when its own workflow/harness changes on `develop`. No cron is installed.

Outputs are uploaded as `nocoreach-connector-runner-smoke-<run-id>` for 7 days: result JSON, step summary, setup/test logs, browser screenshots, Playwright trace, and the synthetic server record. They are not committed back into Git. The script exits nonzero on a failed check; no test step ignores failures.

Local reproduction in a supported environment:

```sh
cd nocoreach/connector-plugins/environment-smoke
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
./node_modules/.bin/playwright install --with-deps chromium
node smoke.mjs
```
