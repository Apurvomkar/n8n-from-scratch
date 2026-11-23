import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { api } from './api';
import {
  flowToWorkflow,
  nodeData,
  workflowToFlow,
  type EditorNode,
  type EditorNodeData,
} from './converter';
import { ConfigPanel } from './components/ConfigPanel';
import { CredentialsDialog } from './components/CredentialsDialog';
import { Palette } from './components/Palette';
import { ResultsPanel } from './components/ResultsPanel';
import { Toolbar } from './components/Toolbar';
import { WorkflowNode } from './components/WorkflowNode';
import type {
  CredentialMeta,
  Execution,
  NodeDefinition,
  RunRecord,
  WorkflowDefinition,
  WorkflowSummary,
} from './types';

const nodeTypes: NodeTypes = { workflow: WorkflowNode };

interface Snapshot {
  nodes: EditorNode[];
  edges: Edge[];
  name: string;
  settings: Record<string, any>;
}

function Editor() {
  const [definitions, setDefinitions] = useState<NodeDefinition[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [workflowName, setWorkflowName] = useState('Untitled workflow');
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<EditorNode>([]);
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState('Ready');
  const [records, setRecords] = useState<RunRecord[]>([]);
  const [success, setSuccess] = useState<boolean | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [credentials, setCredentials] = useState<CredentialMeta[]>([]);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const stateRef = useRef<Snapshot>({ nodes, edges, name: workflowName, settings });
  stateRef.current = { nodes, edges, name: workflowName, settings };

  const record = useCallback(() => {
    const current = stateRef.current;
    setPast((entries) => [...entries.slice(-49), current]);
    setFuture([]);
  }, []);

  const resetHistory = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  const applySnapshot = useCallback(
    (snapshot: Snapshot) => {
      setNodes(snapshot.nodes.map((node) => ({ ...node })));
      setEdges(snapshot.edges.map((edge) => ({ ...edge })));
      setWorkflowName(snapshot.name);
      setSettings({ ...snapshot.settings });
      setSelectedId(null);
    },
    [setNodes, setEdges],
  );

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setFuture((entries) => [stateRef.current, ...entries]);
    applySnapshot(previous);
    setPast(past.slice(0, -1));
  }, [past, applySnapshot]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setPast((entries) => [...entries, stateRef.current]);
    applySnapshot(next);
    setFuture(future.slice(1));
  }, [future, applySnapshot]);

  const historyRef = useRef({ undo, redo });
  historyRef.current = { undo, redo };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) historyRef.current.redo();
        else historyRef.current.undo();
      } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault();
        historyRef.current.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const refreshWorkflows = useCallback(async () => {
    try {
      setWorkflows(await api.workflows());
    } catch (error) {
      setStatus(`Could not list workflows: ${(error as Error).message}`);
    }
  }, []);

  const refreshExecutions = useCallback(async () => {
    try {
      setExecutions(await api.executions());
    } catch (error) {
      setStatus(`Could not load executions: ${(error as Error).message}`);
    }
  }, []);

  const refreshCredentials = useCallback(async () => {
    try {
      setCredentials(await api.credentials());
    } catch (error) {
      setStatus(`Could not load credentials: ${(error as Error).message}`);
    }
  }, []);

  useEffect(() => {
    api
      .nodeTypes()
      .then(setDefinitions)
      .catch((error: unknown) => setStatus(`Could not load node types: ${(error as Error).message}`));
    void refreshWorkflows();
    void refreshExecutions();
    void refreshCredentials();
  }, [refreshWorkflows, refreshExecutions, refreshCredentials]);

  const loadWorkflow = useCallback(
    async (id: string) => {
      try {
        const defs = definitions.length > 0 ? definitions : await api.nodeTypes();
        if (definitions.length === 0) setDefinitions(defs);
        const stored = await api.workflow(id);
        const flow = workflowToFlow(stored.definition, defs);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setWorkflowName(stored.definition.name);
        setSettings(stored.definition.settings ?? {});
        setCurrentId(id);
        setSaved(true);
        setSelectedId(null);
        setRecords([]);
        setSuccess(null);
        resetHistory();
        setStatus(`Loaded '${stored.definition.name}'`);
      } catch (error) {
        setStatus(`Load failed: ${(error as Error).message}`);
      }
    },
    [definitions, setNodes, setEdges, resetHistory],
  );

  const newWorkflow = () => {
    const trigger: EditorNode = {
      id: 'trigger',
      type: 'workflow',
      position: { x: 140, y: 180 },
      data: nodeData('manualTrigger', definitions),
    };
    setNodes([trigger]);
    setEdges([]);
    setWorkflowName('New workflow');
    setSettings({});
    setCurrentId(`wf-${Date.now()}`);
    setSaved(false);
    setSelectedId('trigger');
    setRecords([]);
    setSuccess(null);
    resetHistory();
    setStatus('New workflow — save to persist');
  };

  const save = async () => {
    if (!currentId) {
      setStatus('No workflow selected');
      return;
    }
    try {
      const definition = flowToWorkflow(workflowName, nodes, edges, settings);
      if (saved) {
        await api.saveWorkflow(currentId, definition);
      } else {
        await api.createWorkflow(currentId, definition);
      }
      setSaved(true);
      await refreshWorkflows();
      setStatus('Saved');
    } catch (error) {
      setStatus(`Save failed: ${(error as Error).message}`);
    }
  };

  const run = async () => {
    if (!currentId || !saved) {
      setStatus('Save the workflow before running');
      return;
    }
    try {
      const result = await api.run(currentId);
      setRecords(result.records);
      setSuccess(result.success);
      setStatus(result.success ? 'Run succeeded' : 'Run failed');
      await refreshExecutions();
    } catch (error) {
      setStatus(`Run failed: ${(error as Error).message}`);
    }
  };

  const remove = async () => {
    if (!currentId || !saved) return;
    if (!window.confirm('Delete this workflow?')) return;
    try {
      await api.deleteWorkflow(currentId);
      await refreshWorkflows();
      newWorkflow();
      setStatus('Workflow deleted');
    } catch (error) {
      setStatus(`Delete failed: ${(error as Error).message}`);
    }
  };

  const exportWorkflow = () => {
    const definition = flowToWorkflow(workflowName, nodes, edges, settings);
    const blob = new Blob([JSON.stringify(definition, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(workflowName || 'workflow')
      .replace(/[^a-z0-9-_]+/gi, '-')
      .toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('Workflow exported as JSON');
  };

  const importWorkflow = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as {
        name?: string;
        nodes?: unknown[];
        connections?: Record<string, unknown>;
        settings?: Record<string, any>;
      };
      if (!parsed || !Array.isArray(parsed.nodes) || typeof parsed.connections !== 'object') {
        throw new Error('File does not look like a workflow (needs nodes and connections)');
      }
      const defs = definitions.length > 0 ? definitions : await api.nodeTypes();
      if (definitions.length === 0) setDefinitions(defs);
      const flow = workflowToFlow(
        {
          name: parsed.name ?? 'Imported workflow',
          nodes: parsed.nodes as WorkflowDefinition['nodes'],
          connections: parsed.connections as WorkflowDefinition['connections'],
          settings: parsed.settings,
        },
        defs,
      );
      record();
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setWorkflowName(parsed.name ?? 'Imported workflow');
      setSettings(parsed.settings ?? {});
      setCurrentId(`wf-${Date.now()}`);
      setSaved(false);
      setSelectedId(null);
      setStatus(`Imported '${parsed.name ?? 'workflow'}' — save to persist`);
    } catch (error) {
      setStatus(`Import failed: ${(error as Error).message}`);
    }
  };

  const addNodeAt = (type: string, position?: { x: number; y: number }) => {
    record();
    const node: EditorNode = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: 'workflow',
      position: position ?? {
        x: 220 + Math.random() * 140,
        y: 160 + Math.random() * 140,
      },
      data: nodeData(type, definitions),
    };
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
  };

  const onConnect = useCallback(
    (connection: Connection) => {
      record();
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'smoothstep',
          },
          current,
        ),
      );
    },
    [record, setEdges],
  );

  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/n8n-node');
    if (!type) return;
    addNodeAt(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  const handleNodesChange = useCallback(
    (changes: NodeChange<EditorNode>[]) => {
      if (changes.some((change) => change.type === 'remove')) record();
      onNodesChangeRaw(changes);
      if (changes.some((change) => change.type === 'remove' && change.id === selectedId)) {
        setSelectedId(null);
      }
    },
    [onNodesChangeRaw, selectedId, record],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      if (changes.some((change) => change.type === 'remove')) record();
      onEdgesChangeRaw(changes);
    },
    [onEdgesChangeRaw, record],
  );

  const updateNode = (id: string, patch: Partial<EditorNodeData>) => {
    record();
    setNodes((current) =>
      current.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)),
    );
  };

  const deleteNode = (id: string) => {
    record();
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedId(null);
  };

  const viewExecution = (execution: Execution) => {
    setRecords(execution.records);
    setSuccess(execution.status === 'success');
    setStatus(`Viewing execution ${execution.id.slice(0, 8)}`);
  };

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId),
    [nodes, selectedId],
  );

  return (
    <div className="app">
      <Toolbar
        workflows={workflows}
        currentId={currentId}
        name={workflowName}
        saved={saved}
        status={status}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onSelect={(id) => {
          if (id) void loadWorkflow(id);
        }}
        onNew={newWorkflow}
        onSave={() => void save()}
        onRun={() => void run()}
        onDelete={() => void remove()}
        onCredentials={() => setCredentialsOpen(true)}
        onUndo={undo}
        onRedo={redo}
        onImport={() => fileInputRef.current?.click()}
        onExport={exportWorkflow}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importWorkflow(file);
          event.target.value = '';
        }}
      />

      <div className="app__body">
        <Palette definitions={definitions} onAdd={(type) => addNodeAt(type)} />

        <div className="canvas-wrap" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onNodeDragStart={record}
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.2 }}
          >
            <Background gap={20} />
            <Controls />
            <MiniMap />
            <Panel position="top-left" className="canvas__hint">
              Drag nodes from the palette. Connect the round handles to wire them.
            </Panel>
          </ReactFlow>
        </div>

        <ConfigPanel
          node={selectedNode}
          definitions={definitions}
          name={workflowName}
          onNameChange={setWorkflowName}
          onNameFocus={record}
          settings={settings}
          credentialTypes={
            definitions.find((entry) => entry.type === selectedNode?.data.nodeType)?.credentialTypes ?? []
          }
          credentials={credentials}
          selectedCredentials={selectedNode?.data.credentials ?? {}}
          onChangeCredentials={(next) => {
            if (selectedNode) updateNode(selectedNode.id, { credentials: next });
          }}
          onUpdateNode={updateNode}
          onUpdateSettings={(next) => {
            record();
            setSettings(next);
          }}
          onDeleteNode={deleteNode}
        />
      </div>

      <ResultsPanel
        records={records}
        success={success}
        executions={executions}
        onViewExecution={viewExecution}
      />

      <CredentialsDialog
        open={credentialsOpen}
        credentials={credentials}
        onClose={() => setCredentialsOpen(false)}
        onChanged={() => void refreshCredentials()}
      />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}
