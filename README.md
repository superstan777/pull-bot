# pull-bot

pull-bot is the automation backbone of the `superstan777/pull` project. It bridges GitHub Issues and the Copilot coding agent by acting as a webhook receiver: when a new issue is opened in the `pull` repo, this service automatically navigates to that issue in a headless browser and clicks "Assign to Copilot". It maintains an SQLite-backed queue so that only one issue is ever being processed at a time — subsequent issues are queued and assigned as each one closes.

---

## Prerequisites

- Node.js 20+
- `pm2` installed globally (`npm install -g pm2`)
- Playwright Chromium browser

---

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
# Fill in GITHUB_USERNAME, GITHUB_PASSWORD, WEBHOOK_SECRET, PORT, SESSION_FILE
pm2 start pm2.config.cjs
```

---

## GitHub Secrets (in `superstan777/pull`)

Add these two secrets to the repository that sends webhooks to this bot:

| Secret               | Value                                                      |
| -------------------- | ---------------------------------------------------------- |
| `BOT_WEBHOOK_URL`    | Public URL of this server, e.g. `https://your-vps-ip:3000` |
| `BOT_WEBHOOK_SECRET` | Must match `WEBHOOK_SECRET` in your `.env`                 |

---

## Logs

```bash
pm2 logs pull-bot
```

---

## Manual Webhook Test

```bash
curl -X POST http://localhost:3000/issue \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your_secret" \
  -d '{"action":"opened","issue_number":1,"repo":"superstan777/pull"}'
```

---

## Project Structure

```
pull-bot/
  src/
    server.ts       ← Express app, /issue endpoint
    queue.ts        ← SQLite-backed queue + active state
    playwright.ts   ← GitHub login + assignCopilot()
    types.ts        ← Shared TypeScript types
  .env.example
  pm2.config.cjs
  tsconfig.json
  package.json
  README.md
```
