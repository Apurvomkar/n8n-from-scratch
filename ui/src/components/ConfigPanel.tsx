import { useEffect, useState } from 'react';
import { nodeData, type EditorNode, type EditorNodeData } from '../converter';
import type { CredentialMeta, NodeDefinition } from '../types';

interface ConfigPanelProps {
  node: EditorNode | undefined;
  definitions: NodeDefinition[];
  name: string;
  onNameChange: (name: string) => void;
  settings: Record<string, any>;
  credentialTypes: string[];
  credentials: CredentialMeta[];
  selectedCredentials: Record<string, string>;
  onChangeCredentials: (credentials: Record<string, string>) => void;
  onUpdateNode: (id: string, patch: Partial<EditorNodeData>) => void;
  onUpdateSettings: (settings: Record<string, any>) => void;
  onDeleteNode: (id: string) => void;
}

export function ConfigPanel({
  node,
  definitions,
  name,
  onNameChange,
  settings,
  credentialTypes,
  credentials,
  selectedCredentials,
  onChangeCredentials,
  onUpdateNode,
  onUpdateSettings,
  onDeleteNode,
}: ConfigPanelProps) {
  const [nodeName, setNodeName] = useState('');
  const [paramsText, setParamsText] = useState('{}');
  const [settingsText, setSettingsText] = useState('{}');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setNodeName(node?.data.name ?? '');
    setParamsText(JSON.stringify(node?.data.parameters ?? {}, null, 2));
    setMessage('');
  }, [node?.id, node?.data]);

  useEffect(() => {
    setSettingsText(JSON.stringify(settings, null, 2));
  }, [settings]);

  const applyNode = () => {
    if (!node) return;
    let parameters: Record<string, any>;
    try {
      parameters = JSON.parse(paramsText);
    } catch (error) {
      setMessage(`Invalid parameters JSON: ${(error as Error).message}`);
      return;
    }
    onUpdateNode(node.id, { name: nodeName, parameters });
    setMessage('Node updated');
  };

  const applySettings = () => {
    try {
      const parsed = JSON.parse(settingsText);
      onUpdateSettings(parsed);
      setMessage('Workflow settings updated');
    } catch (error) {
      setMessage(`Invalid settings JSON: ${(error as Error).message}`);
    }
  };

  const changeType = (type: string) => {
    if (!node) return;
    const data = nodeData(type, definitions);
    onUpdateNode(node.id, {
      nodeType: type,
      name: data.name,
      parameters: data.parameters,
      inputs: data.inputs,
      outputs: data.outputs,
      trigger: data.trigger,
    });
    setParamsText(JSON.stringify(data.parameters, null, 2));
    setNodeName(data.name);
  };

  return (
    <aside className="config">
      <h2>{node ? 'Node settings' : 'Workflow settings'}</h2>

      {node ? (
        <>
          <label className="config__label">Type</label>
          <select
            className="config__input"
            value={node.data.nodeType}
            onChange={(event) => changeType(event.target.value)}
          >
            {definitions.map((definition) => (
              <option key={definition.type} value={definition.type}>
                {definition.type}
              </option>
            ))}
          </select>

          <label className="config__label">Name</label>
          <input
            className="config__input"
            value={nodeName}
            onChange={(event) => setNodeName(event.target.value)}
          />

          <label className="config__label">Parameters (JSON)</label>
          <textarea
            className="config__textarea"
            value={paramsText}
            spellCheck={false}
            onChange={(event) => setParamsText(event.target.value)}
          />

          {credentialTypes.length > 0 && (
            <>
              <label className="config__label">Credentials</label>
              {credentialTypes.map((credentialType) => (
                <div key={credentialType} className="config__credential">
                  <span className="config__credential-type">{credentialType}</span>
                  <select
                    className="config__input"
                    value={selectedCredentials[credentialType] ?? ''}
                    onChange={(event) => {
                      const next = { ...selectedCredentials };
                      if (event.target.value) next[credentialType] = event.target.value;
                      else delete next[credentialType];
                      onChangeCredentials(next);
                    }}
                  >
                    <option value="">— none —</option>
                    {credentials
                      .filter((credential) => credential.type === credentialType)
                      .map((credential) => (
                        <option key={credential.id} value={credential.id}>
                          {credential.name}
                        </option>
                      ))}
                  </select>
                </div>
              ))}
            </>
          )}

          <div className="config__actions">
            <button className="btn btn--primary" onClick={applyNode}>
              Apply
            </button>
            <button className="btn btn--danger" onClick={() => onDeleteNode(node.id)}>
              Delete node
            </button>
          </div>
          <p className="config__hint">
            {definitions.find((entry) => entry.type === node.data.nodeType)?.description}
          </p>
        </>
      ) : (
        <>
          <p className="config__hint">
            Select a node to edit it, or configure workflow-level settings below.
          </p>
          <label className="config__label">Workflow name</label>
          <input
            className="config__input"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <label className="config__label">Settings (JSON)</label>
          <textarea
            className="config__textarea config__textarea--tall"
            value={settingsText}
            spellCheck={false}
            onChange={(event) => setSettingsText(event.target.value)}
          />
          <p className="config__hint">
            Example: schedule (cron), webhookToken, defaultItems, timezone.
          </p>
          <div className="config__actions">
            <button className="btn btn--primary" onClick={applySettings}>
              Apply settings
            </button>
          </div>
        </>
      )}

      {message && <p className="config__message">{message}</p>}
    </aside>
  );
}
