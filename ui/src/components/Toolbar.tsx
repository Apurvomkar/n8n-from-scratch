import type { WorkflowSummary } from '../types';

interface ToolbarProps {
  workflows: WorkflowSummary[];
  currentId: string | null;
  name: string;
  saved: boolean;
  status: string;
  canUndo: boolean;
  canRedo: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSave: () => void;
  onRun: () => void;
  onDelete: () => void;
  onCredentials: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onImport: () => void;
  onExport: () => void;
}

export function Toolbar({
  workflows,
  currentId,
  name,
  saved,
  status,
  canUndo,
  canRedo,
  onSelect,
  onNew,
  onSave,
  onRun,
  onDelete,
  onCredentials,
  onUndo,
  onRedo,
  onImport,
  onExport,
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
      <button className="btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
      <button className="btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">Redo</button>
      <button className="btn" onClick={onImport} title="Import workflow JSON">Import</button>
      <button className="btn" onClick={onExport} title="Export workflow JSON">Export</button>
      <button className="btn btn--primary" onClick={onSave}>Save</button>
      <button className="btn btn--run" onClick={onRun}>Run</button>
      <button className="btn btn--danger" onClick={onDelete} disabled={!saved || !currentId}>
        Delete
      </button>
      <button className="btn" onClick={onCredentials}>Credentials</button>

      <div className="toolbar__spacer" />

      <div className="toolbar__status">
        <span className={saved ? 'dot dot--saved' : 'dot dot--dirty'} />
        {name || 'Untitled'} {saved ? '' : '(unsaved)'}
      </div>
      <div className="toolbar__message">{status}</div>
    </header>
  );
}
