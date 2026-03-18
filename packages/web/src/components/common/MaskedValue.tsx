import { useState } from 'react';

interface Props {
  masked: string;
  onReveal: () => Promise<string>;
}

export function MaskedValue({ masked, onReveal }: Props) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleReveal = async () => {
    if (revealed) {
      setRevealed(null);
      return;
    }

    setLoading(true);
    try {
      setRevealed(await onReveal());
    } finally {
      setLoading(false);
    }
  };

  const value = revealed ?? masked;

  return (
    <div className="token-row">
      <span className="token-value mono">{value}</span>
      <button className="secondary-button" onClick={() => void handleReveal()} disabled={loading}>
        {loading ? 'Loading...' : revealed ? 'Hide' : 'Reveal'}
      </button>
      <button className="ghost-button" onClick={() => void navigator.clipboard.writeText(value)}>
        Copy
      </button>
    </div>
  );
}
