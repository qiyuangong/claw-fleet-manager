import { describe, expect, it } from 'vitest';
import { AppError, safeError } from '../../src/errors.js';

describe('safeError', () => {
  it('returns message from AppError unchanged', () => {
    expect(safeError(new AppError('instance not found', 'NOT_FOUND', 404))).toBe('instance not found');
  });

  it('returns short Error message unchanged', () => {
    expect(safeError(new Error('container stopped'))).toBe('container stopped');
  });

  it('strips Error messages containing file paths', () => {
    expect(safeError(new Error('ENOENT /home/user/.openclaw/config.json'))).toBe('An internal error occurred');
  });

  it('strips Error messages over 200 chars', () => {
    expect(safeError(new Error('x'.repeat(201)))).toBe('An internal error occurred');
  });

  it('handles null / undefined gracefully', () => {
    expect(safeError(null)).toBe('An internal error occurred');
    expect(safeError(undefined)).toBe('An internal error occurred');
  });

  it('handles plain string throws gracefully', () => {
    expect(safeError('oops')).toBe('An internal error occurred');
  });
});

describe('AppError', () => {
  it('preserves statusCode and code', () => {
    const err = new AppError('bad input', 'INVALID_ID', 400);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('INVALID_ID');
    expect(err.name).toBe('AppError');
  });

  it('defaults statusCode to 500', () => {
    expect(new AppError('boom', 'INTERNAL').statusCode).toBe(500);
  });
});
