import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
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
  WorkflowSummary,
} from './types';

const nodeTypes: NodeTypes = { workflow: WorkflowNode };

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
  const { screenToFlowPosition } = useReactFlow();

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
        setStatus(`Loaded '${stored.definition.name}'`);
      } catch (error) {
        setStatus(`Load failed: ${(error as Error).message}`);
      }
    },
    [definitions, setNodes, setEdges],
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

  const addNodeAt = (type: string, position?: { x: number; y: number }) => {
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
    [setEdges],
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
      onNodesChangeRaw(changes);
      if (changes.some((change) => change.type === 'remove' && change.id === selectedId)) {
        setSelectedId(null);
      }
    },
    [onNodesChangeRaw, selectedId],
  );

  const updateNode = (id: string, patch: Partial<EditorNodeData>) => {
    setNodes((current) =>
      current.map((node) => (node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)),
    );
  };

  const deleteNode = (id: string) => {
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
        onSelect={(id) => {
          if (id) void loadWorkflow(id);
        }}
        onNew={newWorkflow}
        onSave={() => void save()}
        onRun={() => void run()}
        onDelete={() => void remove()}
        onCredentials={() => setCredentialsOpen(true)}
      />

      <div className="app__body">
        <Palette definitions={definitions} onAdd={(type) => addNodeAt(type)} />

        <div className="canvas-wrap" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChangeRaw}
            onConnect={onConnect}
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
          onUpdateSettings={setSettings}
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
