import express, { type Request, type Response } from "express";
import "dotenv/config";
import { getActive, setActive, enqueue, dequeue } from "./queue.js";
import {
  initBrowser,
  closeBrowser,
  assignCopilot,
  markPRReady,
} from "./playwright.js";
import type { WebhookPayload } from "./types.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "";

const app = express();
app.use(express.json());

function isValidPayload(body: unknown): body is WebhookPayload {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;

  if (b.event === "issues" && b.action === "opened") {
    return (
      typeof b.issue_number === "number" &&
      typeof b.repo === "string" &&
      b.repo.length > 0
    );
  }
  if (b.event === "pull_request" && b.action === "edited") {
    return (
      typeof b.pr_number === "number" &&
      typeof b.repo === "string" &&
      b.repo.length > 0 &&
      typeof b.title === "string" &&
      typeof b.previous_title === "string"
    );
  }
  if (b.event === "pull_request" && b.action === "closed") {
    return (
      typeof b.pr_number === "number" &&
      typeof b.repo === "string" &&
      b.repo.length > 0 &&
      typeof b.merged === "boolean"
    );
  }
  return false;
}

async function processNext(): Promise<void> {
  const next = dequeue();
  if (!next) {
    setActive(null);
    return;
  }
  setActive(next);
  try {
    await assignCopilot(next.issue_number, next.repo);
  } catch (err) {
    console.error(
      `[pull-bot] ERROR: processNext — failed to assign Copilot to ${next.repo}#${next.issue_number} — ${(err as Error).message}`,
    );
    setActive(null);
  }
}

app.post("/webhook", (req: Request, res: Response): void => {
  try {
    const secret = req.headers["x-webhook-secret"];
    if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
      res.status(403).end();
      return;
    }
    if (!isValidPayload(req.body)) {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }

    const payload = req.body;

    if (payload.event === "issues") {
      const issue = { issue_number: payload.issue_number, repo: payload.repo };
      const active = getActive();
      if (active === null) {
        setActive(issue);
        res.status(200).json({ status: "assigning" });
        setImmediate(() => {
          assignCopilot(issue.issue_number, issue.repo)
            .then(() => {
              console.info(
                `[pull-bot] INFO: Copilot assigned to ${issue.repo}#${issue.issue_number}`,
              );
            })
            .catch((err: unknown) => {
              console.error(
                `[pull-bot] ERROR: assignCopilot — ${(err as Error).message}`,
              );
              setActive(null);
              processNext().catch((e: unknown) => {
                console.error(
                  `[pull-bot] ERROR: processNext after failure — ${(e as Error).message}`,
                );
              });
            });
        });
      } else {
        enqueue(issue);
        res.status(200).json({ status: "queued" });
      }
      return;
    }

    if (payload.event === "pull_request" && payload.action === "edited") {
      const wasWip = payload.previous_title.startsWith("[WIP]");
      const stillWip = payload.title.startsWith("[WIP]");
      if (!wasWip || stillWip) {
        res.status(200).json({ status: "ignored" });
        return;
      }
      res.status(200).json({ status: "marking_ready" });
      setImmediate(() => {
        markPRReady(payload.pr_number, payload.repo).catch((err: unknown) => {
          console.error(
            `[pull-bot] ERROR: markPRReady — ${(err as Error).message}`,
          );
        });
      });
      return;
    }

    if (payload.event === "pull_request" && payload.action === "closed") {
      if (!payload.merged) {
        res.status(200).json({ status: "ignored" });
        return;
      }
      setActive(null);
      res.status(200).json({ status: "dequeuing" });
      setImmediate(() => {
        processNext().catch((err: unknown) => {
          console.error(
            `[pull-bot] ERROR: processNext — ${(err as Error).message}`,
          );
        });
      });
    }
  } catch (err) {
    console.error(
      `[pull-bot] ERROR: /webhook handler — ${(err as Error).message}`,
    );
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

async function main(): Promise<void> {
  setActive(null);

  try {
    await initBrowser();
    console.info("[pull-bot] INFO: Browser initialized");
  } catch (err) {
    console.error(
      `[pull-bot] ERROR: Failed to initialize browser — ${(err as Error).message}`,
    );
    process.exit(1);
  }

  processNext().catch((err: unknown) => {
    console.error(
      `[pull-bot] ERROR: startup processNext — ${(err as Error).message}`,
    );
  });

  const server = app.listen(PORT, () => {
    console.info(`[pull-bot] INFO: Listening on port ${PORT}`);
  });

  const shutdown = async (): Promise<void> => {
    console.info("[pull-bot] INFO: Shutting down…");
    server.close();
    await closeBrowser();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown().catch(console.error);
  });
  process.on("SIGTERM", () => {
    shutdown().catch(console.error);
  });
}

main().catch((err: unknown) => {
  console.error(`[pull-bot] ERROR: startup — ${(err as Error).message}`);
  process.exit(1);
});
