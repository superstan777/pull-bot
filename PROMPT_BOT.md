# Prompt: VPS Bot (pull-bot)

## Context

This bot is the automation backbone of the `superstan777/pull` project.
It bridges GitHub Issues and the Copilot coding agent — handling what GitHub's
API cannot: automatically clicking "Assign to Copilot" in the GitHub UI via
browser automation.

Full pipeline spec: `superstan777/pull/.github/FLOW.md`

---

## Goal

Build a standalone Node.js service in a **new repo `superstan777/pull-bot`**.

The bot does two things:

1. **Queue manager** — tracks which GitHub Issue is currently active (Copilot
   working on it), and queues new issues when one is already active.
2. **Playwright automator** — logs into GitHub and clicks "Assign to Copilot"
   on the next issue whenever a slot opens up.

---

## Trigger Flow

```
GitHub Actions (repo: pull)
    │  POST /issue  {action: "opened"|"closed", issue_number, repo}
    ▼
Bot (Express)
    │
    ├── action == "opened"
    │     ├── no active issue → assignCopilot(issue_number) → mark active
    │     └── active issue exists → push to queue
    │
    └── action == "closed"
          ├── mark current issue as done
          └── queue not empty → dequeue oldest → assignCopilot(issue_number)
```

---

## Project Structure

```
pull-bot/
  src/
    server.ts          ← Express app, /issue endpoint
    queue.ts           ← SQLite-backed queue + active state
    playwright.ts      ← GitHub login + assignCopilot(issueNumber, repo)
    types.ts           ← shared TypeScript types
  .env.example         ← documents all required env vars
  pm2.config.cjs       ← PM2 ecosystem config
  tsconfig.json
  package.json
  README.md
```

---

## Tech Stack

| Concern     | Package                     |
| ----------- | --------------------------- |
| Server      | `express`                   |
| Database    | `better-sqlite3`            |
| Browser     | `playwright` (chromium)     |
| TypeScript  | `typescript`, `tsx`         |
| Process mgr | `pm2` (external, not a dep) |
| Env vars    | `dotenv`                    |

TypeScript strict mode. No `any`. No `@ts-ignore`.

---

## Environment Variables

```env
# GitHub credentials for Playwright login
GITHUB_USERNAME=
GITHUB_PASSWORD=

# Shared secret — must match BOT_WEBHOOK_SECRET in GitHub repo secrets
WEBHOOK_SECRET=

# Express
PORT=3000

# Path to persist Playwright session cookies (absolute or relative)
SESSION_FILE=./session.json
```

---

## `src/server.ts`

- Express app, single route: `POST /issue`
- Middleware: verify `X-Webhook-Secret` header against `WEBHOOK_SECRET` env var.
  Return `403` on mismatch — reject silently (no body reveals secret).
- Parse JSON body: `{ action: "opened" | "closed", issue_number: number, repo: string }`
- Validate all three fields — return `400` on invalid input
- Call queue logic (see `queue.ts`), respond `200 OK` immediately
- Do **not** await Playwright inside the request handler — enqueue and return.
  Playwright runs asynchronously after response is sent.
- All errors caught with try/catch, logged to stdout, never crash the process

---

## `src/queue.ts`

SQLite database (`queue.db` in project root). Two tables:

```sql
CREATE TABLE IF NOT EXISTS state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_number INTEGER NOT NULL,
  repo         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`state` table stores a single row: `key = 'active'`, `value = JSON of active
issue or NULL`.

Exported functions:

```ts
getActive(): { issue_number: number; repo: string } | null
setActive(issue: { issue_number: number; repo: string } | null): void
enqueue(issue: { issue_number: number; repo: string }): void
dequeue(): { issue_number: number; repo: string } | null  // oldest first
```

---

## `src/playwright.ts`

### Session management

On startup, attempt to restore session from `SESSION_FILE` (JSON array of
Playwright cookies). If file does not exist or session is expired, perform
full login.

### Login flow

```
1. goto https://github.com/login
2. fill #login_field with GITHUB_USERNAME
3. fill #password with GITHUB_PASSWORD
4. click [name="commit"]
5. wait for navigation to https://github.com (not /login — indicates success)
6. save cookies to SESSION_FILE
```

If after step 5 the URL still contains `/login`, throw an error — login failed.

### assignCopilot(issueNumber: number, repo: string)

```
1. Restore or perform login (see above)
2. goto https://github.com/{repo}/issues/{issueNumber}
3. Wait for the page to fully load (#assignees-select-menu selector visible)
4. Click the gear icon next to "Assignees" (button[data-menu-trigger="assignees-select-menu"])
5. Wait for assignee picker to open (ul[data-menu-target] visible)
6. Look for a list item or suggestion containing the text "Copilot"
7. Click it
8. Close the picker by pressing Escape or clicking outside
9. Verify: wait for the assignees section to show "Copilot" text
10. Save updated cookies to SESSION_FILE
```

If step 6 finds no "Copilot" option, throw a descriptive error — do NOT silently
succeed. This means "Assign to Copilot" is not available for the repo/plan.

All Playwright steps wrapped in try/catch. On any failure: log full error with
issue number and repo, rethrow so caller can decide retry logic.

Use **headed mode: false** (headless). Launch with:

```ts
const browser = await chromium.launch({ headless: true });
```

Reuse a single browser instance across calls — do not launch a new browser per
assignment. Expose `initBrowser()` and `closeBrowser()` called at startup/shutdown.

---

## `pm2.config.cjs`

```js
module.exports = {
  apps: [
    {
      name: "pull-bot",
      script: "tsx",
      args: "src/server.ts",
      env_file: ".env",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      error_file: "logs/error.log",
      out_file: "logs/out.log",
    },
  ],
};
```

---

## `README.md`

Must include:

1. What this bot does (one paragraph)
2. Prerequisites (Node 20+, pm2 installed globally, Playwright chromium)
3. Setup steps:
   ```bash
   npm install
   npx playwright install chromium
   cp .env.example .env
   # fill in .env
   pm2 start pm2.config.cjs
   ```
4. GitHub Secrets to add in `superstan777/pull` repo:
   - `BOT_WEBHOOK_URL` — public URL of this server, e.g. `https://your-vps-ip:3000`
   - `BOT_WEBHOOK_SECRET` — must match `WEBHOOK_SECRET` in `.env`
5. How to check logs: `pm2 logs pull-bot`
6. How to test webhook manually:
   ```bash
   curl -X POST http://localhost:3000/issue \
     -H "Content-Type: application/json" \
     -H "X-Webhook-Secret: your_secret" \
     -d '{"action":"opened","issue_number":1,"repo":"superstan777/pull"}'
   ```

---

## Error Handling Rules

- Every async function has `try/catch`
- Errors logged as: `[pull-bot] ERROR: {context} — {message}`
- Failed `assignCopilot` does not crash the process — log and continue
- If login fails, retry once with a fresh browser session (delete SESSION_FILE,
  re-launch). If retry also fails, log and halt assignment for this issue.
- No `console.log` for normal flow — use `console.info` for operations,
  `console.error` for errors

---

## Constraints

- TypeScript strict, no `any`
- Max 200 lines per file — split into helpers if needed
- No test framework needed for this project (purely side-effectful I/O)
- Do not use `nodemon` — PM2 handles restarts
- `tsx` is used to run TypeScript directly (no build step needed for a bot)
- Playwright must run headless — this runs on a VPS with no display
- Never log credentials (password, webhook secret) to stdout
