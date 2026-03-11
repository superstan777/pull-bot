import express, { type Request, type Response } from "express";
import "dotenv/config";
import { getActive, setActive, enqueue, dequeue } from "./queue.js";
import { initBrowser, closeBrowser, assignCopilot } from "./playwright.js";
import type { Issue, WebhookPayload } from "./types.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "";

const app = express();
app.use(express.json());

function isValidPayload(body: unknown): body is WebhookPayload {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    (b.action === "opened" || b.action === "closed") &&
    typeof b.issue_number === "number" &&
    typeof b.repo === "string" &&
    b.repo.length > 0
  );
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
    // Continue draining the queue even if one fails
    setActive(null);
  }
}

app.post("/issue", (req: Request, res: Response): void => {
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
    const issue: Issue = {
      issue_number: payload.issue_number,
      repo: payload.repo,
    };

    if (payload.action === "opened") {
      const active = getActive();
      if (active === null) {
        setActive(issue);
        res.status(200).json({ status: "assigning" });
        // Run after response is sent
        setImmediate(() => {
          assignCopilot(issue.issue_number, issue.repo)
            .then(() => {
              setActive(null);
              return processNext();
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
    } else {
      // action === "closed"
      setActive(null);
      res.status(200).json({ status: "closed" });
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
      `[pull-bot] ERROR: /issue handler — ${(err as Error).message}`,
    );
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

async function main(): Promise<void> {
  // Clear stale active state left from a previous crashed run
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

  // Drain any queue items that were left over before the previous shutdown
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
