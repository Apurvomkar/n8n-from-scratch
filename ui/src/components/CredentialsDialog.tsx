import { useState } from 'react';
import { api } from '../api';
import type { CredentialMeta } from '../types';

interface CredentialsDialogProps {
  open: boolean;
  credentials: CredentialMeta[];
  onClose: () => void;
  onChanged: () => void;
}

const SUGGESTED_TYPES = ['slackApi', 'emailApi', 'sqlite', 'httpBasicAuth', 'apiKey'];

export function CredentialsDialog({
  open,
  credentials,
  onClose,
  onChanged,
}: CredentialsDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('slackApi');
  const [dataText, setDataText] = useState('{\n  "token": ""\n}');
  const [error, setError] = useState('');

  if (!open) return null;

  const create = async () => {
    try {
      const data = JSON.parse(dataText);
      if (typeof data !== 'object' || data === null) throw new Error('data must be a JSON object');
      await api.createCredential(name, type, data);
      setName('');
      setError('');
      onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteCredential(id);
      onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal__header">
          <h2>Credentials</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <p className="config__hint">
          Secrets are encrypted at rest. Only names and types are shown here — values are never
          returned by the API.
        </p>

        <div className="modal__body">
          <div className="modal__column">
            <h3>Saved credentials</h3>
            {credentials.length === 0 ? (
              <p className="results__empty">None yet.</p>
            ) : (
              <ul className="modal__list">
                {credentials.map((credential) => (
                  <li key={credential.id}>
                    <span className="modal__cred-name">{credential.name}</span>
                    <span className="modal__cred-type">{credential.type}</span>
                    <button className="btn btn--danger" onClick={() => void remove(credential.id)}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="modal__column">
            <h3>New credential</h3>
            <label className="config__label">Name</label>
            <input
              className="config__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My Slack token"
            />
            <label className="config__label">Type</label>
            <input
              className="config__input"
              list="credential-types"
              value={type}
              onChange={(event) => setType(event.target.value)}
            />
            <datalist id="credential-types">
              {SUGGESTED_TYPES.map((entry) => <option key={entry} value={entry} />)}
            </datalist>
            <label className="config__label">Data (JSON)</label>
            <textarea
              className="config__textarea"
              value={dataText}
              spellCheck={false}
              onChange={(event) => setDataText(event.target.value)}
            />
            <div className="config__actions">
              <button className="btn btn--primary" onClick={() => void create()}>
                Create credential
              </button>
            </div>
            {error && <p className="modal__error">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
