import type {
  CredentialMeta,
  Execution,
  NodeDefinition,
  RunResponse,
  StoredWorkflow,
  WorkflowDefinition,
  WorkflowSummary,
} from './types';

const API_KEY_STORAGE = 'n8n-editor-api-key';

export function getApiKey(): string {
  try {
    return sessionStorage.getItem(API_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(value: string): void {
  try {
    if (value.trim()) sessionStorage.setItem(API_KEY_STORAGE, value.trim());
    else sessionStorage.removeItem(API_KEY_STORAGE);
  } catch {
    // Storage can be unavailable in restricted browsing modes.
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const key = getApiKey();
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const body = JSON.parse(text);
      message = body.error ?? (Array.isArray(body.errors) ? body.errors.join('; ') : text);
    } catch {
      // keep raw text
    }
    throw new Error(
      response.status === 401
        ? 'Unauthorized — open "API key" and enter the server key'
        : message,
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  nodeTypes: () => request<NodeDefinition[]>('/api/nodes'),

  workflows: () => request<WorkflowSummary[]>('/api/workflows'),

  workflow: (id: string) => request<StoredWorkflow>(`/api/workflows/${id}`),

  createWorkflow: (id: string, definition: WorkflowDefinition) =>
    request<StoredWorkflow>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({ ...definition, id }),
    }),

  saveWorkflow: (id: string, definition: WorkflowDefinition) =>
    request<StoredWorkflow>(`/api/workflows/${id}`, {
      method: 'PUT',
      body: JSON.stringify(definition),
    }),

  deleteWorkflow: (id: string) =>
    request<void>(`/api/workflows/${id}`, { method: 'DELETE' }),

  run: (id: string) =>
    request<RunResponse>(`/api/workflows/${id}/run`, {
      method: 'POST',
      body: JSON.stringify({ items: [] }),
    }),

  executions: (limit = 20) =>
    request<Execution[]>(`/api/executions?limit=${limit}`),

  credentials: () => request<CredentialMeta[]>('/api/credentials'),

  createCredential: (name: string, type: string, data: Record<string, any>) =>
    request<CredentialMeta>('/api/credentials', {
      method: 'POST',
      body: JSON.stringify({ name, type, data }),
    }),

  deleteCredential: (id: string) =>
    request<void>(`/api/credentials/${id}`, { method: 'DELETE' }),
};
