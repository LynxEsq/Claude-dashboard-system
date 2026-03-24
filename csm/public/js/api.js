/**
 * API client for CSM backend
 */
const API = {
  // ─── Sessions ────────────────────────────────
  getSessions: () => fetch('/api/sessions').then(r => r.json()),
  createSession: (data) => fetch('/api/sessions/create', {
    method: 'POST', headers: CT, body: JSON.stringify(data)
  }).then(r => r.json()),
  sendInput: (name, input) => fetch(`/api/sessions/${name}/send`, {
    method: 'POST', headers: CT, body: JSON.stringify({ input })
  }).then(r => r.json()),
  focusSession: (name) => fetch(`/api/sessions/${name}/focus`, { method: 'POST' }).then(r => r.json()),
  restartSession: (name) => fetch(`/api/sessions/${name}/restart`, { method: 'POST' }).then(r => r.json()),
  deleteProject: (name) => fetch(`/api/sessions/${encodeURIComponent(name)}/destroy`, { method: 'POST' }).then(r => r.json()),

  // ─── Wishes ──────────────────────────────────
  getWishes: (name) => fetch(`/api/pipeline/${name}/wishes`).then(r => r.json()),
  addWish: (name, content) => fetch(`/api/pipeline/${name}/wishes`, {
    method: 'POST', headers: CT, body: JSON.stringify({ content })
  }).then(r => r.json()),
  updateWish: (id, content) => fetch(`/api/pipeline/wishes/${id}`, {
    method: 'PUT', headers: CT, body: JSON.stringify({ content })
  }).then(r => r.json()),
  deleteWish: (id) => fetch(`/api/pipeline/wishes/${id}`, { method: 'DELETE' }).then(r => r.json()),

  // ─── Tasks ───────────────────────────────────
  getTasks: (name, status) => {
    const qs = status ? `?status=${status}` : '';
    return fetch(`/api/pipeline/${name}/tasks${qs}`).then(r => r.json());
  },
  addTask: (name, data) => fetch(`/api/pipeline/${name}/tasks`, {
    method: 'POST', headers: CT, body: JSON.stringify(data)
  }).then(r => r.json()),
  updateTask: (id, data) => fetch(`/api/pipeline/tasks/${id}`, {
    method: 'PUT', headers: CT, body: JSON.stringify(data)
  }).then(r => r.json()),
  deleteTask: (id) => fetch(`/api/pipeline/tasks/${id}`, { method: 'DELETE' }).then(r => r.json()),

  // ─── Pipeline ────────────────────────────────
  plan: (name) => fetch(`/api/pipeline/${name}/plan`, { method: 'POST' }).then(r => r.json()),
  planStatus: (name) => fetch(`/api/pipeline/${name}/plan/status`).then(r => r.json()),
  applyPlan: (name, data) => fetch(`/api/pipeline/${name}/apply-plan`, {
    method: 'POST', headers: CT, body: JSON.stringify(data)
  }).then(r => r.json()),
  executeInteractive: (name, taskId) => fetch(`/api/pipeline/${name}/execute-interactive`, {
    method: 'POST', headers: CT, body: JSON.stringify({ taskId })
  }).then(r => r.json()),
  executeNext: (name) => fetch(`/api/pipeline/${name}/execute`, { method: 'POST' }).then(r => r.json()),
  executeSilent: (name, taskId) => fetch(`/api/pipeline/${name}/execute-silent`, {
    method: 'POST', headers: CT, body: JSON.stringify({ taskId })
  }).then(r => r.json()),
  taskExecStatus: (name, taskId) => fetch(`/api/pipeline/${name}/task-status/${taskId}`).then(r => r.json()),

  // ─── Terminal ───────────────────────────────
  sendKeys: (name, keys) => fetch(`/api/sessions/${name}/keys`, {
    method: 'POST', headers: CT, body: JSON.stringify({ keys })
  }).then(r => r.json()),
  openTerminal: (name) => fetch(`/api/sessions/${name}/terminal`, { method: 'POST' }).then(r => r.json()),

  // ─── Permissions ──────────────────────────────
  getPermissions: (name) => fetch(`/api/sessions/${encodeURIComponent(name)}/permissions`).then(r => r.json()),
  setPermissions: (name, permissions) => fetch(`/api/sessions/${encodeURIComponent(name)}/permissions`, {
    method: 'POST', headers: CT, body: JSON.stringify({ permissions })
  }).then(r => r.json()),

  // ─── Tmux ─────────────────────────────────────
  getTmuxSessions: () => fetch('/api/tmux/sessions').then(r => r.json()),
  openTmuxSession: (name, tmuxName) => fetch(`/api/sessions/${encodeURIComponent(name || '_')}/terminal?tmux=${encodeURIComponent(tmuxName)}`, { method: 'POST', headers: CT, body: '{}' }).then(r => r.json()),

  // ─── Alerts ──────────────────────────────────
  getAlerts: () => fetch('/api/alerts').then(r => r.json()),
  ackAlert: (id) => fetch(`/api/alerts/${id}/acknowledge`, { method: 'POST' }).then(r => r.json()),
};

const CT = { 'Content-Type': 'application/json' };
