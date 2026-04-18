export class InvalidSessionHistoryCursorError extends Error {
  constructor(message = 'Invalid cursor') {
    super(message);
    this.name = 'InvalidSessionHistoryCursorError';
  }
}
