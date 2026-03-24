/**
 * Global application state
 */
const State = {
  sessions: {},
  selected: null,       // selected project name
  selectedTask: null,   // selected task id
  wishes: [],
  tasks: [],
  alerts: [],
  editingWish: null,    // wish id being edited
  editingTask: null,    // task id being edited
  planningSession: null, // tmux session name when planning is active
  planningProjects: new Set(), // project names with active planning
  liveMode: true,        // auto-refresh terminal output
  taskCounts: {},        // { sessionName: { completed, running, pending, failed, total } }
  selectedWish: null,    // wish id selected to show linked tasks
  taskDependencies: {},  // { taskId: [{blockerTaskId, blockerTitle, blockerStatus, reason}] }
  taskModes: {},         // { taskId: 'interactive' | 'silent' }
  taskDiffs: {},         // { taskId: { files_changed, insertions, deletions, summary } }
  planningWishIds: new Set(), // wish IDs currently being planned
  platform: { platform: 'unknown', name: 'Unknown', terminal: 'Terminal' },
  isRemote: false,
  sshInfo: { user: '', host: '' },
};

// Task status order for sorting (merge_pending between running and completed)
const TASK_STATUS_ORDER = { running: 0, merge_pending: 1, pending: 2, completed: 3, failed: 4 };

const STATUS_LABELS = {
  working: 'Working',
  needs_input: 'Needs Input',
  idle: 'Idle',
  error: 'Error',
  offline: 'Offline',
};
