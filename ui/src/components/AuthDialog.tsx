import { useState } from 'react';
import { getApiKey, setApiKey } from '../api';

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AuthDialog({ open, onClose }: AuthDialogProps) {
  const [value, setValue] = useState(getApiKey());
  const [message, setMessage] = useState('');

  if (!open) return null;

  const apply = () => {
    setApiKey(value);
    setMessage(value.trim() ? 'API key saved for this browser session' : 'API key cleared');
    setTimeout(onClose, 500);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--small" onClick={(event) => event.stopPropagation()}>
        <div className="modal__header">
          <h2>API key</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <p className="config__hint">
          The server can require a bearer token for all API calls. Enter the value of the
          server's <code>API_KEY</code> to connect this browser. It is kept only in this
          browser session and is never stored in the workflow.
        </p>
        <label className="config__label">Bearer token</label>
        <input
          className="config__input"
          type="password"
          value={value}
          placeholder="Paste API key"
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="config__actions">
          <button className="btn btn--primary" onClick={apply}>Save key</button>
          <button
            className="btn"
            onClick={() => {
              setValue('');
              setApiKey('');
              setMessage('API key cleared');
            }}
          >
            Clear
          </button>
        </div>
        {message && <p className="config__message">{message}</p>}
      </div>
    </div>
  );
}
