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
};

const STATUS_LABELS = {
  working: 'Working',
  needs_input: 'Needs Input',
  idle: 'Idle',
  error: 'Error',
  offline: 'Offline',
};
