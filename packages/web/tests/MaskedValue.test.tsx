import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MaskedValue } from '../src/components/common/MaskedValue';

describe('MaskedValue', () => {
  it('renders masked value initially', () => {
    render(<MaskedValue masked="abc1***f456" onReveal={() => Promise.resolve('full-token')} />);
    expect(screen.getByText('abc1***f456')).toBeInTheDocument();
  });

  it('shows full token after reveal button click', async () => {
    const onReveal = vi.fn().mockResolvedValue('full-secret-token');
    render(<MaskedValue masked="abc***456" onReveal={onReveal} />);

    await userEvent.click(screen.getByRole('button', { name: /reveal/i }));

    await waitFor(() => expect(screen.getByText('full-secret-token')).toBeInTheDocument());
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it('hides token again when hide button is clicked', async () => {
    const onReveal = vi.fn().mockResolvedValue('full-secret-token');
    render(<MaskedValue masked="abc***456" onReveal={onReveal} />);

    await userEvent.click(screen.getByRole('button', { name: /reveal/i }));
    await waitFor(() => screen.getByText('full-secret-token'));

    await userEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(screen.queryByText('full-secret-token')).not.toBeInTheDocument();
    expect(screen.getByText('abc***456')).toBeInTheDocument();
  });

  it('shows error message when onReveal throws', async () => {
    const onReveal = vi.fn().mockRejectedValue(new Error('not authorized'));
    render(<MaskedValue masked="abc***456" onReveal={onReveal} />);

    await userEvent.click(screen.getByRole('button', { name: /reveal/i }));

    await waitFor(() => expect(screen.getByText('not authorized')).toBeInTheDocument());
  });

  it('reveal button is disabled while loading', async () => {
    let resolve!: (value: string) => void;
    const onReveal = vi.fn(
      () => new Promise<string>((r) => {
        resolve = r;
      }),
    );
    render(<MaskedValue masked="abc***456" onReveal={onReveal} />);

    await userEvent.click(screen.getByRole('button', { name: /reveal/i }));

    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
    await act(async () => {
      resolve('token');
    });
  });
});
