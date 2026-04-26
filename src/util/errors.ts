export const ExitCode = {
  Ok: 0,
  Generic: 1,
  Auth: 2,
  Quota: 3,
  Validation: 4,
  PollTimeout: 5,
  JobFailed: 6,
  DoctorFailed: 7,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export class GdrError extends Error {
  readonly exitCode: ExitCodeValue;
  constructor(message: string, exitCode: ExitCodeValue = ExitCode.Generic) {
    super(message);
    this.name = "GdrError";
    this.exitCode = exitCode;
  }
}

export class AuthError extends GdrError {
  constructor(message = "missing or invalid API key — run `gdr auth` or set GEMINI_API_KEY") {
    super(message, ExitCode.Auth);
    this.name = "AuthError";
  }
}

export class QuotaError extends GdrError {
  constructor(message = "rate limit or quota exceeded") {
    super(message, ExitCode.Quota);
    this.name = "QuotaError";
  }
}

export class ValidationError extends GdrError {
  constructor(message: string) {
    super(message, ExitCode.Validation);
    this.name = "ValidationError";
  }
}

export class TimeoutError extends GdrError {
  readonly jobId: string;
  constructor(jobId: string) {
    super(`poll timed out for job ${jobId} — re-run \`gdr wait ${jobId}\` to resume`, ExitCode.PollTimeout);
    this.name = "TimeoutError";
    this.jobId = jobId;
  }
}

export class JobFailedError extends GdrError {
  readonly jobId: string;
  readonly status: string;
  constructor(jobId: string, status: string, detail?: string) {
    super(`job ${jobId} ended in state \`${status}\`${detail ? `: ${detail}` : ""}`, ExitCode.JobFailed);
    this.name = "JobFailedError";
    this.jobId = jobId;
    this.status = status;
  }
}
