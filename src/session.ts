import type { BrowserContext, Cookie } from "playwright";
import fs from "node:fs";
import "dotenv/config";

const SESSION_FILE = process.env.SESSION_FILE ?? "./session.json";
const GITHUB_USERNAME = process.env.GITHUB_USERNAME ?? "";
const GITHUB_PASSWORD = process.env.GITHUB_PASSWORD ?? "";

export async function tryRestoreSession(
  context: BrowserContext,
): Promise<boolean> {
  if (!fs.existsSync(SESSION_FILE)) return false;
  try {
    const raw = fs.readFileSync(SESSION_FILE, "utf-8");
    const cookies: Cookie[] = JSON.parse(raw) as Cookie[];
    await context.addCookies(cookies);
    const page = await context.newPage();
    try {
      await page.goto("https://github.com", { waitUntil: "domcontentloaded" });
      return !page.url().includes("/login");
    } finally {
      await page.close();
    }
  } catch {
    return false;
  }
}

export async function login(context: BrowserContext): Promise<void> {
  if (!GITHUB_USERNAME || !GITHUB_PASSWORD) {
    throw new Error("GITHUB_USERNAME and GITHUB_PASSWORD must be set");
  }
  const page = await context.newPage();
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
    await saveSession(context);
    console.info("[pull-bot] INFO: GitHub login successful");
  } finally {
    await page.close();
  }
}

export async function saveSession(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
}

export function deleteSessionFile(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
  } catch {
    // ignore
  }
}

export async function ensureLoggedIn(context: BrowserContext): Promise<void> {
  const restored = await tryRestoreSession(context);
  if (!restored) {
    await login(context);
  }
}
