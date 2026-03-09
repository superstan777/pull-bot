import Database from "better-sqlite3";
import type { Issue, QueueRow, StateRow } from "./types.js";

const db = new Database("queue.db");

db.exec(`
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
`);

// Ensure the state row exists
const existing = db
  .prepare<[], StateRow>("SELECT * FROM state WHERE key = 'active'")
  .get();
if (!existing) {
  db.prepare("INSERT INTO state (key, value) VALUES ('active', 'null')").run();
}

export function getActive(): Issue | null {
  const row = db
    .prepare<[], StateRow>("SELECT value FROM state WHERE key = 'active'")
    .get();
  if (!row) return null;
  const parsed: unknown = JSON.parse(row.value);
  if (parsed === null) return null;
  return parsed as Issue;
}

export function setActive(issue: Issue | null): void {
  db.prepare("UPDATE state SET value = ? WHERE key = 'active'").run(
    JSON.stringify(issue),
  );
}

export function enqueue(issue: Issue): void {
  db.prepare("INSERT INTO queue (issue_number, repo) VALUES (?, ?)").run(
    issue.issue_number,
    issue.repo,
  );
}

export function dequeue(): Issue | null {
  const row = db
    .prepare<[], QueueRow>("SELECT * FROM queue ORDER BY id ASC LIMIT 1")
    .get();
  if (!row) return null;
  db.prepare("DELETE FROM queue WHERE id = ?").run(row.id);
  return { issue_number: row.issue_number, repo: row.repo };
}
