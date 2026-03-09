import {
  chromium,
  type Browser,
  type BrowserContext,
  type Cookie,
} from "playwright";
import fs from "node:fs";
import "dotenv/config";

const SESSION_FILE = process.env.SESSION_FILE ?? "./session.json";
const GITHUB_USERNAME = process.env.GITHUB_USERNAME ?? "";
const GITHUB_PASSWORD = process.env.GITHUB_PASSWORD ?? "";

let browser: Browser | null = null;
let context: BrowserContext | null = null;

export async function initBrowser(): Promise<void> {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  await tryRestoreSession();
}

export async function closeBrowser(): Promise<void> {
  await context?.close();
  await browser?.close();
  browser = null;
  context = null;
}

async function tryRestoreSession(): Promise<boolean> {
  if (!fs.existsSync(SESSION_FILE)) return false;
  try {
    const raw = fs.readFileSync(SESSION_FILE, "utf-8");
    const cookies: Cookie[] = JSON.parse(raw) as Cookie[];
    await context!.addCookies(cookies);
    // Quick check: visit GitHub and see if we're logged in
    const page = await context!.newPage();
    try {
      await page.goto("https://github.com", { waitUntil: "domcontentloaded" });
      const url = page.url();
      return !url.includes("/login");
    } finally {
      await page.close();
    }
  } catch {
    return false;
  }
}

async function login(): Promise<void> {
  if (!GITHUB_USERNAME || !GITHUB_PASSWORD) {
    throw new Error("GITHUB_USERNAME and GITHUB_PASSWORD must be set");
  }

  const page = await context!.newPage();
  try {
    await page.goto("https://github.com/login", {
      waitUntil: "domcontentloaded",
    });
    await page.fill("#login_field", GITHUB_USERNAME);
    await page.fill("#password", GITHUB_PASSWORD);
    await page.click('[name="commit"]');
    await page.waitForNavigation({ waitUntil: "domcontentloaded" });

    if (page.url().includes("/login")) {
      throw new Error("Login failed — URL still contains /login after submit");
    }

    await saveSession();
    console.info("[pull-bot] INFO: GitHub login successful");
  } finally {
    await page.close();
  }
}

async function saveSession(): Promise<void> {
  const cookies = await context!.cookies();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
}

function deleteSessionFile(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
  } catch {
    // ignore
  }
}

async function ensureLoggedIn(): Promise<void> {
  const restored = await tryRestoreSession();
  if (!restored) {
    await login();
  }
}

export async function assignCopilot(
  issueNumber: number,
  repo: string,
): Promise<void> {
  if (!browser || !context) {
    throw new Error("Browser not initialized — call initBrowser() first");
  }

  try {
    await tryAssign(issueNumber, repo);
  } catch (err) {
    // Retry once with fresh session
    console.error(
      `[pull-bot] ERROR: assignCopilot first attempt — ${(err as Error).message}. Retrying with fresh login.`,
    );
    deleteSessionFile();
    await context.clearCookies();
    try {
      await login();
      await tryAssign(issueNumber, repo);
    } catch (retryErr) {
      console.error(
        `[pull-bot] ERROR: assignCopilot retry failed for issue #${issueNumber} in ${repo} — ${(retryErr as Error).message}`,
      );
      throw retryErr;
    }
  }
}

async function tryAssign(issueNumber: number, repo: string): Promise<void> {
  await ensureLoggedIn();

  const page = await context!.newPage();
  try {
    const issueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
    await page.goto(issueUrl, { waitUntil: "domcontentloaded" });

    // Wait for React to render the sidebar
    await page.waitForTimeout(4000);

    // GitHub's React UI renders a direct "Assign to Copilot" button
    const copilotBtn = page
      .locator("button")
      .filter({ hasText: /^assign to copilot$/i })
      .first();

    const count = await copilotBtn.count();
    if (count === 0) {
      throw new Error(
        `"Assign to Copilot" button not found for ${repo}#${issueNumber} — feature may not be enabled for this repo/plan`,
      );
    }

    await copilotBtn.click();

    // GitHub opens a confirmation modal — wait for it and click "Assign"
    const modalAssignBtn = page
      .locator('dialog button, [role="dialog"] button')
      .filter({ hasText: /^assign$/i })
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

    // Wait for modal to close (dialog gone)
    await page
      .locator('dialog, [role="dialog"]')
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {
        console.info(
          `[pull-bot] INFO: Modal did not close within timeout for ${repo}#${issueNumber}, proceeding anyway`,
        );
      });

    await saveSession();
    console.info(
      `[pull-bot] INFO: Successfully assigned Copilot to ${repo}#${issueNumber}`,
    );
  } finally {
    await page.close();
  }
}
