import type { WorkflowSummary } from '../types';

interface ToolbarProps {
  workflows: WorkflowSummary[];
  currentId: string | null;
  name: string;
  saved: boolean;
  status: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSave: () => void;
  onRun: () => void;
  onDelete: () => void;
  onCredentials: () => void;
}

export function Toolbar({
  workflows,
  currentId,
  name,
  saved,
  status,
  onSelect,
  onNew,
  onSave,
  onRun,
  onDelete,
  onCredentials,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar__brand">n8n from scratch <span>editor</span></div>

      <select
        className="toolbar__select"
        value={currentId ?? ''}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">— select workflow —</option>
        {workflows.map((workflow) => (
          <option key={workflow.id} value={workflow.id}>
            {workflow.name}
          </option>
        ))}
      </select>

      <button className="btn" onClick={onNew}>New</button>
      <button className="btn btn--primary" onClick={onSave}>Save</button>
      <button className="btn btn--run" onClick={onRun}>Run</button>
      <button className="btn btn--danger" onClick={onDelete} disabled={!saved || !currentId}>
        Delete
      </button>
      <button className="btn" onClick={onCredentials}>
        Credentials
      </button>

      <div className="toolbar__spacer" />

      <div className="toolbar__status">
        <span className={saved ? 'dot dot--saved' : 'dot dot--dirty'} />
        {name || 'Untitled'} {saved ? '' : '(unsaved)'}
      </div>
      <div className="toolbar__message">{status}</div>
    </header>
  );
}
