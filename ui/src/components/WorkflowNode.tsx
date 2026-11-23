import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { EditorNode } from '../converter';

export function WorkflowNode({ data, selected }: NodeProps<EditorNode>) {
  const inputCount = Math.max(data.inputs, 0);
  const outputCount = Math.max(data.outputs, 1);

  return (
    <div
      className={`wf-node${selected ? ' wf-node--selected' : ''}${data.trigger ? ' wf-node--trigger' : ''}`}
    >
      {Array.from({ length: inputCount }, (_, index) => (
        <Handle
          key={`in-${index}`}
          id={`in-${index}`}
          type="target"
          position={Position.Left}
          style={{ top: `${((index + 1) / (inputCount + 1)) * 100}%` }}
        />
      ))}

      <div className="wf-node__type">{data.nodeType}</div>
      <div className="wf-node__name">{data.name}</div>
      <div className="wf-node__ports">
        {inputCount} in / {outputCount} out
      </div>

      {Array.from({ length: outputCount }, (_, index) => (
        <Handle
          key={`out-${index}`}
          id={`out-${index}`}
          type="source"
          position={Position.Right}
          style={{ top: `${((index + 1) / (outputCount + 1)) * 100}%` }}
        />
      ))}
    </div>
  );
}
