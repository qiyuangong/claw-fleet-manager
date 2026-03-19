import { useState } from 'react';

interface Props {
  masked: string;
  onReveal: () => Promise<string>;
}

export function MaskedValue({ masked, onReveal }: Props) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const resetCopyState = () => {
    window.setTimeout(() => setCopyState('idle'), 1800);
  };

  const fallbackCopy = (value: string): boolean => {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = value;
      textArea.setAttribute('readonly', '');
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textArea);
      return ok;
    } catch {
      return false;
    }
  };

  const handleReveal = async () => {
    setError(null);
    if (revealed) {
      setRevealed(null);
      return;
    }

    setLoading(true);
    try {
      setRevealed(await onReveal());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to reveal token');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    setError(null);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else if (!fallbackCopy(value)) {
        throw new Error('Clipboard access is not available');
      }

      setCopyState('copied');
      resetCopyState();
    } catch {
      if (fallbackCopy(value)) {
        setCopyState('copied');
      } else {
        setCopyState('failed');
        setError('Copy failed. Reveal the token and copy it manually.');
      }
      resetCopyState();
    }
  };

  const value = revealed ?? masked;
  const copyLabel = copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy';

  return (
    <>
      <div className="token-row">
        <span className="token-value mono">{value}</span>
        <button className="secondary-button" onClick={() => void handleReveal()} disabled={loading}>
          {loading ? 'Loading...' : revealed ? 'Hide' : 'Reveal'}
        </button>
        <button className="ghost-button" onClick={() => void handleCopy()}>
          {copyLabel}
        </button>
      </div>
      {error ? <p className="token-status error-text">{error}</p> : null}
      {!error && copyState === 'copied' ? <p className="token-status success-text">Token copied to clipboard.</p> : null}
    </>
  );
}
