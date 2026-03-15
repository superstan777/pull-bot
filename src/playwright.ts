import { chromium, type Browser, type BrowserContext } from "playwright";
import {
  ensureLoggedIn,
  login,
  saveSession,
  deleteSessionFile,
} from "./session.js";

let browser: Browser | null = null;
let context: BrowserContext | null = null;

export async function initBrowser(): Promise<void> {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  await ensureLoggedIn(context);
}

export async function closeBrowser(): Promise<void> {
  await context?.close();
  await browser?.close();
  browser = null;
  context = null;
}

export async function assignCopilot(
  issueNumber: number,
  repo: string,
): Promise<void> {
  if (!browser || !context) {
    throw new Error("Browser not initialized — call initBrowser() first");
  }
  try {
    await tryAssign(context, issueNumber, repo);
  } catch (err) {
    console.error(
      `[pull-bot] ERROR: assignCopilot first attempt — ${(err as Error).message}. Retrying with fresh login.`,
    );
    deleteSessionFile();
    await context.clearCookies();
    try {
      await login(context);
      await tryAssign(context, issueNumber, repo);
    } catch (retryErr) {
      console.error(
        `[pull-bot] ERROR: assignCopilot retry failed for issue #${issueNumber} in ${repo} — ${(retryErr as Error).message}`,
      );
      throw retryErr;
    }
  }
}

async function tryAssign(
  ctx: BrowserContext,
  issueNumber: number,
  repo: string,
): Promise<void> {
  await ensureLoggedIn(ctx);
  const page = await ctx.newPage();
  try {
    await page.goto(`https://github.com/${repo}/issues/${issueNumber}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(4000);

    const copilotBtn = page
      .locator("button")
      .filter({ hasText: /^assign to copilot$/i })
      .first();

    if ((await copilotBtn.count()) === 0) {
      throw new Error(
        `"Assign to Copilot" button not found for ${repo}#${issueNumber} — feature may not be enabled for this repo/plan`,
      );
    }
    await copilotBtn.click();

    const modalAssignBtn = page
      .locator('[role="dialog"] button[class*="assignButton"]')
      .first();
    try {
      await modalAssignBtn.waitFor({ state: "visible", timeout: 8_000 });
      await modalAssignBtn.click();
      console.info(
        `[pull-bot] INFO: Clicked modal Assign button for ${repo}#${issueNumber}`,
      );
    } catch {
      throw new Error(
        `Modal "Assign" button not found after clicking "Assign to Copilot" for ${repo}#${issueNumber}`,
      );
    }

    await page
      .locator('[role="dialog"].prc-Dialog-Dialog-G8cDF')
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {
        console.info(
          `[pull-bot] INFO: Modal did not close within timeout for ${repo}#${issueNumber}, proceeding anyway`,
        );
      });

    await saveSession(ctx);
    console.info(
      `[pull-bot] INFO: Successfully assigned Copilot to ${repo}#${issueNumber}`,
    );
  } finally {
    await page.close();
  }
}

export async function markPRReady(
  prNumber: number,
  repo: string,
): Promise<void> {
  if (!browser || !context) {
    throw new Error("Browser not initialized — call initBrowser() first");
  }
  try {
    await tryMarkReady(context, prNumber, repo);
  } catch (err) {
    console.error(
      `[pull-bot] ERROR: markPRReady first attempt — ${(err as Error).message}. Retrying with fresh login.`,
    );
    deleteSessionFile();
    await context.clearCookies();
    try {
      await login(context);
      await tryMarkReady(context, prNumber, repo);
    } catch (retryErr) {
      console.error(
        `[pull-bot] ERROR: markPRReady retry failed for PR #${prNumber} in ${repo} — ${(retryErr as Error).message}`,
      );
      throw retryErr;
    }
  }
}

async function tryMarkReady(
  ctx: BrowserContext,
  prNumber: number,
  repo: string,
): Promise<void> {
  await ensureLoggedIn(ctx);
  const page = await ctx.newPage();
  try {
    await page.goto(`https://github.com/${repo}/pull/${prNumber}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(3000);

    const readyBtn = page
      .locator("button")
      .filter({ hasText: /ready for review/i })
      .first();

    if ((await readyBtn.count()) === 0) {
      console.info(
        `[pull-bot] INFO: "Ready for review" button not found for ${repo}#${prNumber} — PR may already be ready or merged`,
      );
      return;
    }

    await readyBtn.click();
    await readyBtn.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {
      console.info(
        `[pull-bot] INFO: "Ready for review" button still visible after click for ${repo}#${prNumber}, proceeding anyway`,
      );
    });

    await saveSession(ctx);
    console.info(
      `[pull-bot] INFO: Successfully marked PR ${repo}#${prNumber} as ready for review`,
    );
  } finally {
    await page.close();
  }
}
