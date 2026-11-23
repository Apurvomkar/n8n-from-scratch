import type { Execution, RunRecord } from '../types';

interface ResultsPanelProps {
  records: RunRecord[];
  success: boolean | null;
  executions: Execution[];
  onViewExecution: (execution: Execution) => void;
}

export function ResultsPanel({
  records,
  success,
  executions,
  onViewExecution,
}: ResultsPanelProps) {
  const hasIterations = records.some((record) => record.iteration !== undefined);

  return (
    <section className="results">
      <div className="results__section">
        <h3>
          Last run{' '}
          {success === null ? '' : (
            <span className={success ? 'badge badge--ok' : 'badge badge--fail'}>
              {success ? 'success' : 'failure'}
            </span>
          )}
        </h3>
        {records.length === 0 ? (
          <p className="results__empty">No run yet. Save the workflow and press Run.</p>
        ) : (
          <table className="results__table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Status</th>
                <th>In</th>
                <th>Out</th>
                {hasIterations && <th>Iter</th>}
              </tr>
            </thead>
            <tbody>
              {records.map((record, index) => (
                <tr key={`${record.nodeId}-${index}`}>
                  <td>{record.name}</td>
                  <td><span className={`badge badge--${record.status}`}>{record.status}</span></td>
                  <td>{record.inputs}</td>
                  <td>{record.outputs.join('/')}</td>
                  {hasIterations && <td>{record.iteration ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="results__section">
        <h3>Execution history</h3>
        {executions.length === 0 ? (
          <p className="results__empty">No executions recorded yet.</p>
        ) : (
          <ul className="results__history">
            {executions.map((execution) => (
              <li key={execution.id}>
                <button onClick={() => onViewExecution(execution)}>
                  <span className={`badge badge--${execution.status === 'success' ? 'ok' : 'fail'}`}>
                    {execution.status}
                  </span>
                  <span className="results__history-name">{execution.workflowName}</span>
                  <span className="results__history-time">
                    {new Date(execution.startedAt).toLocaleTimeString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
