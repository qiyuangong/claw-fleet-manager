export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly cause?: unknown;

  constructor(message: string, code: string, statusCode = 500, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const INTERNAL_ERROR_MESSAGE = 'An internal error occurred';

export function safeError(err: unknown): string {
  if (err instanceof AppError) {
    return err.message;
  }

  if (err instanceof Error) {
    const message = err.message ?? '';
    if (!message || message.length > 200 || /[\\/]/.test(message)) {
      return INTERNAL_ERROR_MESSAGE;
    }
    return message;
  }

  return INTERNAL_ERROR_MESSAGE;
}
