export interface Issue {
  issue_number: number;
  repo: string;
}

export interface WebhookPayload {
  action: "opened" | "closed";
  issue_number: number;
  repo: string;
}

export interface StateRow {
  key: string;
  value: string;
}

export interface QueueRow {
  id: number;
  issue_number: number;
  repo: string;
  created_at: string;
}
