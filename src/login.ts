/**
 * One-shot interactive login script.
 * Run on the VPS when GitHub asks for an OTP / device verification code:
 *
 *   node_modules/.bin/tsx src/login.ts
 *
 * It logs in, handles the OTP prompt via stdin, then saves session.json.
 * After this the main bot uses the saved session and won't need to log in again
 * until the session expires (~30–60 days).
 */

import { chromium } from "playwright";
import fs from "node:fs";
import readline from "node:readline";
import "dotenv/config";

const SESSION_FILE = process.env.SESSION_FILE ?? "./session.json";
const GITHUB_USERNAME = process.env.GITHUB_USERNAME ?? "";
const GITHUB_PASSWORD = process.env.GITHUB_PASSWORD ?? "";

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  if (!GITHUB_USERNAME || !GITHUB_PASSWORD) {
    console.error(
      "ERROR: GITHUB_USERNAME and GITHUB_PASSWORD must be set in .env",
    );
    process.exit(1);
  }

  console.info("Launching browser…");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Step 1: Login
    console.info("Navigating to GitHub login…");
    await page.goto("https://github.com/login", {
      waitUntil: "domcontentloaded",
    });
    await page.fill("#login_field", GITHUB_USERNAME);
    await page.fill("#password", GITHUB_PASSWORD);
    await page.click('[name="commit"]');
    await page.waitForNavigation({ waitUntil: "domcontentloaded" });

    let currentUrl = page.url();
    console.info(`After login: ${currentUrl}`);

    // Step 2: Handle OTP / device verification if present
    // GitHub shows either /sessions/verified-device or /login/device-verification
    // or an inline OTP field on the login page itself
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/device-verification") ||
      currentUrl.includes("/verified-device") ||
      currentUrl.includes("/challenge") ||
      currentUrl.includes("/sessions/two-factor")
    ) {
      // Check for OTP input field
      const otpSelectors = [
        'input[name="otp"]',
        'input[autocomplete="one-time-code"]',
        "#otp",
        'input[name="app_otp"]',
        'input[placeholder*="code" i]',
      ];

      let otpSelector: string | null = null;
      for (const sel of otpSelectors) {
        if ((await page.locator(sel).count()) > 0) {
          otpSelector = sel;
          break;
        }
      }

      if (otpSelector) {
        console.info("\nGitHub is asking for a verification code.");
        console.info("Check your email and enter the code below:");
        const code = await prompt("OTP code: ");

        await page.fill(otpSelector, code);

        // Submit — try a submit button, fallback to Enter
        const submitBtn = page
          .locator('button[type="submit"], input[type="submit"]')
          .first();
        if ((await submitBtn.count()) > 0) {
          await submitBtn.click();
        } else {
          await page.keyboard.press("Enter");
        }

        await page.waitForNavigation({ waitUntil: "domcontentloaded" });
        currentUrl = page.url();
        console.info(`After OTP: ${currentUrl}`);
      } else {
        console.error(
          "ERROR: Still on auth page but no OTP field found. Current URL:",
          currentUrl,
        );
        console.error("Page title:", await page.title());
        await browser.close();
        process.exit(1);
      }
    }

    // Step 3: Verify we're logged in
    if (currentUrl.includes("/login") || currentUrl.includes("/sessions")) {
      console.error("ERROR: Login failed — still on auth page after OTP.");
      await browser.close();
      process.exit(1);
    }

    // Step 4: Save cookies
    const cookies = await context.cookies();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
    console.info(`\nSuccess! Session saved to ${SESSION_FILE}`);
    console.info("You can now start the bot: pm2 start pm2.config.cjs");
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error("ERROR:", (err as Error).message);
  process.exit(1);
});
