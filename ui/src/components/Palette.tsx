import type { NodeDefinition } from '../types';

interface PaletteProps {
  definitions: NodeDefinition[];
  onAdd: (type: string) => void;
}

export function Palette({ definitions, onAdd }: PaletteProps) {
  const onDragStart = (event: React.DragEvent, type: string) => {
    event.dataTransfer.setData('application/n8n-node', type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="palette">
      <h2>Node palette</h2>
      <p className="palette__hint">Drag onto the canvas or click to add.</p>
      <div className="palette__list">
        {definitions.map((definition) => (
          <div
            key={definition.type}
            className={`palette__item${definition.trigger ? ' palette__item--trigger' : ''}`}
            draggable
            onDragStart={(event) => onDragStart(event, definition.type)}
            onClick={() => onAdd(definition.type)}
            title={definition.description}
          >
            <span className="palette__type">{definition.type}</span>
            <span className="palette__meta">
              {definition.trigger ? 'trigger' : `${definition.inputs}→${definition.outputs}`}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
