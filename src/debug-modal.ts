/**
 * Debug script — run on VPS to inspect modal after clicking "Assign to Copilot"
 * Usage: node_modules/.bin/tsx src/debug-modal.ts <issue_number> <repo>
 * Example: node_modules/.bin/tsx src/debug-modal.ts 15 superstan777/pull
 */

import { chromium } from "playwright";
import fs from "node:fs";
import "dotenv/config";

const SESSION_FILE = process.env.SESSION_FILE ?? "./session.json";

const issueNumber = process.argv[2];
const repo = process.argv[3];

if (!issueNumber || !repo) {
  console.error("Usage: tsx src/debug-modal.ts <issue_number> <repo>");
  process.exit(1);
}

async function main(): Promise<void> {
  const cookies = JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  await page.goto(`https://github.com/${repo}/issues/${issueNumber}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(4000);

  // Find and click "Assign to Copilot"
  const btn = page.locator("button").filter({ hasText: /assign to copilot/i }).first();
  console.log("Assign to Copilot button count:", await btn.count());

  if (await btn.count() === 0) {
    console.error("Button not found!");
    await browser.close();
    return;
  }

  await btn.click();
  console.log("Clicked 'Assign to Copilot', waiting for modal...");
  await page.waitForTimeout(3000);

  // Dump all buttons visible now
  const allButtons = await page.$$eval("button", els =>
    els
      .filter(el => (el as HTMLElement).offsetParent !== null) // visible only
      .map(el => ({
        text: el.textContent?.trim().slice(0, 100),
        class: el.className?.toString().slice(0, 80),
        type: el.getAttribute("type"),
        ariaLabel: el.getAttribute("aria-label"),
      }))
  );
  console.log("\nAll visible buttons after click:");
  console.log(JSON.stringify(allButtons, null, 2));

  // Dump dialog/modal elements
  const dialogs = await page.$$eval(
    'dialog, [role="dialog"], [data-dialog], [data-focus-trap]',
    els => els.map(el => ({
      tag: el.tagName,
      role: el.getAttribute("role"),
      class: el.className?.toString().slice(0, 80),
      html: el.innerHTML.slice(0, 500),
    }))
  );
  console.log("\nDialog/modal elements:");
  console.log(JSON.stringify(dialogs, null, 2));

  // Save full page HTML for manual inspection
  fs.writeFileSync("/root/pull-bot/modal-debug.html", await page.content());
  console.log("\nFull page HTML saved to /root/pull-bot/modal-debug.html");

  await browser.close();
}

main().catch((err: unknown) => {
  console.error("ERROR:", (err as Error).message);
  process.exit(1);
});
