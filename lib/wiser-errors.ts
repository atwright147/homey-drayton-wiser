export class WiserAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WiserAuthError';
  }
}

export class WiserConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WiserConnectionError';
  }
}

export class WiserRestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Wiser REST error ${status}: ${body}`);
    this.name = 'WiserRestError';
    this.status = status;
    this.body = body;
  }

  get retryable(): boolean {
    return this.status >= 500;
  }
}
