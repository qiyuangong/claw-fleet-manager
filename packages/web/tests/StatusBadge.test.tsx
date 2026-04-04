import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '../src/components/common/StatusBadge';

describe('StatusBadge', () => {
  it('renders a span with status-running class', () => {
    const { container } = render(<StatusBadge status="running" />);
    const span = container.querySelector('span');
    expect(span).toHaveClass('status-dot', 'status-running');
  });

  it('renders a span with status-stopped class', () => {
    const { container } = render(<StatusBadge status="stopped" />);
    expect(container.querySelector('span')).toHaveClass('status-stopped');
  });

  it('renders a span with status-unhealthy class', () => {
    const { container } = render(<StatusBadge status="unhealthy" />);
    expect(container.querySelector('span')).toHaveClass('status-unhealthy');
  });
});
