export interface Issue {
  issue_number: number;
  repo: string;
}

export interface IssuesOpenedPayload {
  event: "issues";
  action: "opened";
  issue_number: number;
  repo: string;
}

export interface PullRequestEditedPayload {
  event: "pull_request";
  action: "edited";
  pr_number: number;
  repo: string;
  title: string;
  previous_title: string;
}

export interface PullRequestClosedPayload {
  event: "pull_request";
  action: "closed";
  pr_number: number;
  repo: string;
  merged: boolean;
}

export type WebhookPayload =
  | IssuesOpenedPayload
  | PullRequestEditedPayload
  | PullRequestClosedPayload;

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
