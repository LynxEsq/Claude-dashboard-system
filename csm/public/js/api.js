/**
 * API client for CSM backend
 */

const CT = { 'Content-Type': 'application/json' };

/**
 * Wrapper around fetch that handles HTTP errors and network failures.
 * Returns parsed JSON on success, throws ApiError on failure.
 */
class ApiError extends Error {
  constructor(message, code, hint) {
    super(message);
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN';
    this.hint = hint || null;
  }
}

async function apiFetch(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    // Network-level error (no response at all)
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      throw new ApiError(
        'Нет соединения с сервером CSM',
        'NETWORK_ERROR',
        'Убедитесь, что CSM сервер запущен (node src/index.js web)'
      );
    }
    throw new ApiError(err.message, 'FETCH_ERROR');
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new ApiError(msg, data?.code || 'HTTP_' + res.status, data?.hint || null);
  }

  return data;
}

const API = {
  // ─── Sessions ────────────────────────────────
  getSessions: () => apiFetch('/api/sessions'),
  createSession: (data) => apiFetch('/api/sessions/create', {
    method: 'POST', headers: CT, body: JSON.stringify(data)
  }),
  sendInput: (name, input) => apiFetch(`/api/sessions/${name}/send`, {
    method: 'POST', headers: CT, body: JSON.stringify({ input })
  }),
  focusSession: (name) => apiFetch(`/api/sessions/${name}/focus`, { method: 'POST' }),
  sendTaskInput: (taskId, input) => apiFetch(`/api/tasks/${taskId}/send`, {
    method: 'POST', headers: CT, body: JSON.stringify({ input })
  }),
  focusTask: (taskId) => apiFetch(`/api/tasks/${taskId}/focus`, { method: 'POST' }),
  sendTaskKeys: (taskId, keys) => apiFetch(`/api/tasks/${taskId}/keys`, {
    method: 'POST', headers: CT, body: JSON.stringify({ keys })
  }),
  restartSession: (name) => apiFetch(`/api/sessions/${name}/restart`, { method: 'POST' }),
  deleteProject: (name) => apiFetch(`/api/sessions/${encodeURIComponent(name)}/destroy`, { method: 'POST' }),

  // ─── Wishes ──────────────────────────────────
  getWishes: (name) => apiFetch(`/api/pipeline/${name}/wishes`),
  addWish: (name, content) => apiFetch(`/api/pipeline/${name}/wishes`, {
    method: 'POST', headers: CT, body: JSON.stringify({ content })
  }),
  updateWish: (id, content) => apiFetch(`/api/pipeline/wishes/${id}`, {
    method: 'PUT', headers: CT, body: JSON.stringify({ content })
  }),
  deleteWish: (id) => apiFetch(`/api/pipeline/wishes/${id}`, { method: 'DELETE' }),

  // ─── Tasks ───────────────────────────────────
  getTasks: (name, status) => {
    const qs = status ? `?status=${status}` : '';
    return apiFetch(`/api/pipeline/${name}/tasks${qs}`);
  },
  addTask: (name, data) => apiFetch(`/api/pipeline/${name}/tasks`, {
    method: 'POST', headers: CT, body: JSON.stringify(data)
  }),
  updateTask: (id, data) => apiFetch(`/api/pipeline/tasks/${id}`, {
    method: 'PUT', headers: CT, body: JSON.stringify(data)
  }),
  deleteTask: (id) => apiFetch(`/api/pipeline/tasks/${id}`, { method: 'DELETE' }),

  // ─── Pipeline ────────────────────────────────
  plan: (name) => apiFetch(`/api/pipeline/${name}/plan`, { method: 'POST' }),
  planStatus: (name) => apiFetch(`/api/pipeline/${name}/plan/status`),
  applyPlan: (name, data) => apiFetch(`/api/pipeline/${name}/apply-plan`, {
    method: 'POST', headers: CT, body: JSON.stringify(data)
  }),
  executeInteractive: (name, taskId, opts) => apiFetch(`/api/pipeline/${name}/execute-interactive`, {
    method: 'POST', headers: CT, body: JSON.stringify({ taskId, ...opts })
  }),
  executeNext: (name) => apiFetch(`/api/pipeline/${name}/execute`, { method: 'POST' }),
  executeSilent: (name, taskId, opts) => apiFetch(`/api/pipeline/${name}/execute-silent`, {
    method: 'POST', headers: CT, body: JSON.stringify({ taskId, ...opts })
  }),
  taskExecStatus: (name, taskId) => apiFetch(`/api/pipeline/${name}/task-status/${taskId}`),
  taskFullOutput: (name, taskId) => apiFetch(`/api/pipeline/${name}/task-output/${taskId}`),

  // ─── Worktree / Merge ─────────────────────────
  mergeTask: (name, taskId, action) => apiFetch(`/api/pipeline/${name}/tasks/${taskId}/merge`, {
    method: 'POST', headers: CT, body: JSON.stringify({ action })
  }),
  getTaskDiff: (name, taskId) => apiFetch(`/api/pipeline/${name}/tasks/${taskId}/diff`),
  openWorktreeTerminal: (name, taskId) => apiFetch(`/api/pipeline/${name}/tasks/${taskId}/open-terminal`, { method: 'POST' }),

  // ─── Terminal ───────────────────────────────
  sendKeys: (name, keys) => apiFetch(`/api/sessions/${name}/keys`, {
    method: 'POST', headers: CT, body: JSON.stringify({ keys })
  }),
  openTerminal: (name) => apiFetch(`/api/sessions/${name}/terminal`, { method: 'POST' }),

  // ─── Permissions ──────────────────────────────
  getPermissions: (name) => apiFetch(`/api/sessions/${encodeURIComponent(name)}/permissions`),
  setPermissions: (name, permissions) => apiFetch(`/api/sessions/${encodeURIComponent(name)}/permissions`, {
    method: 'POST', headers: CT, body: JSON.stringify({ permissions })
  }),

  // ─── Tmux ─────────────────────────────────────
  getTmuxSessions: () => apiFetch('/api/tmux/sessions'),
  openTmuxSession: (name, tmuxName) => apiFetch(`/api/sessions/${encodeURIComponent(name || '_')}/terminal?tmux=${encodeURIComponent(tmuxName)}`, { method: 'POST', headers: CT, body: '{}' }),
  trackSession: (name, tmuxSession, projectPath) => apiFetch('/api/config/session', {
    method: 'POST', headers: CT, body: JSON.stringify({ name, tmuxSession, projectPath })
  }),
  untrackSession: (name) => apiFetch(`/api/config/session/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // ─── Alerts ──────────────────────────────────
  getAlerts: () => apiFetch('/api/alerts'),
  ackAlert: (id) => apiFetch(`/api/alerts/${id}/acknowledge`, { method: 'POST' }),

  // ─── Platform ─────────────────────────────────
  getPlatform: () => apiFetch('/api/platform'),
  getAccessInfo: () => apiFetch('/api/access-info'),

  // ─── Session Tmux Sessions ───────────────────
  getSessionTmuxList: (name) => apiFetch(`/api/sessions/${encodeURIComponent(name)}/tmux-sessions`),
  recreateTmuxSession: (name) => apiFetch(`/api/sessions/${encodeURIComponent(name)}/recreate-tmux`, { method: 'POST' }),

  // ─── Filesystem ──────────────────────────────
  listDir: (dirPath) => apiFetch(`/api/fs/list?path=${encodeURIComponent(dirPath || '')}`),

  // ─── Config ──────────────────────────────────
  updateSession: (name, data) => apiFetch(`/api/config/session`, {
    method: 'POST', headers: CT, body: JSON.stringify({ name, ...data })
  }),
};
