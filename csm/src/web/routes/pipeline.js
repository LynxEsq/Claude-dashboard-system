const { execSync } = require('child_process');
const fs = require('fs');
const { safe } = require('../middleware');

module.exports = function (app, ctx) {
  const { config, pipeline, broadcast, wss } = ctx;
  const worktree = require('../../lib/worktree');
  const platform = require('../../lib/platform');

  // Restore persistent session mappings (task↔tmux) from DB on startup
  try {
    pipeline.restoreSessionMappings();
    console.log('[Pipeline] Restored session mappings from DB');
  } catch (err) {
    console.error('[Pipeline] Failed to restore session mappings:', err.message);
  }

  // ─── Wishes ─────────────────────────────────────────

  app.get('/api/pipeline/:name/wishes', safe((req, res) => {
    res.json(pipeline.getAllWishes(req.params.name));
  }));

  app.post('/api/pipeline/:name/wishes', safe((req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const id = pipeline.addWish(req.params.name, content);
    ctx.bumpActivity(req.params.name);
    broadcast(wss, { type: 'wishAdded', data: { sessionName: req.params.name, id, content } });
    res.json({ success: true, id });
  }));

  app.put('/api/pipeline/wishes/:id', safe((req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    pipeline.updateWish(parseInt(req.params.id), content);
    res.json({ success: true });
  }));

  app.delete('/api/pipeline/wishes/:id', safe((req, res) => {
    pipeline.deleteWish(parseInt(req.params.id));
    res.json({ success: true });
  }));

  // ─── Tasks ──────────────────────────────────────────

  app.get('/api/pipeline/:name/tasks', safe((req, res) => {
    res.json(pipeline.getTasks(req.params.name, req.query.status || null));
  }));

  app.post('/api/pipeline/:name/tasks', safe((req, res) => {
    const { title, description, wishIds, priority, blocked_by } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const id = pipeline.createTask(req.params.name, title, description || '', wishIds || [], priority || 0);
    if (blocked_by && Array.isArray(blocked_by) && blocked_by.length > 0) {
      pipeline.saveTaskDependencies(id, blocked_by);
    }
    const blockers = pipeline.getBlockersForTask(id);
    broadcast(wss, { type: 'taskCreated', data: { sessionName: req.params.name, id, title, blocked_by: blockers } });
    res.json({ success: true, id });
  }));

  app.put('/api/pipeline/tasks/:id/status', safe((req, res) => {
    const { status, outputSummary } = req.body;
    pipeline.updateTaskStatus(parseInt(req.params.id), status, outputSummary);
    res.json({ success: true });
  }));

  app.put('/api/pipeline/tasks/:id', safe((req, res) => {
    pipeline.updateTask(parseInt(req.params.id), req.body);
    res.json({ success: true });
  }));

  app.delete('/api/pipeline/tasks/:id', safe((req, res) => {
    pipeline.deleteTask(parseInt(req.params.id));
    res.json({ success: true });
  }));

  // ─── Task Dependencies ──────────────────────────────

  app.get('/api/pipeline/tasks/:id/dependencies', safe((req, res) => {
    const taskId = parseInt(req.params.id);
    res.json({
      blocked_by: pipeline.getBlockersForTask(taskId),
      blocks: pipeline.getDependentsOfTask(taskId),
    });
  }));

  app.post('/api/pipeline/tasks/:id/dependencies', safe((req, res) => {
    const taskId = parseInt(req.params.id);
    const { blocked_by } = req.body;
    if (!Array.isArray(blocked_by)) return res.status(400).json({ error: 'blocked_by must be an array' });
    pipeline.removeTaskDependencies(taskId);
    pipeline.saveTaskDependencies(taskId, blocked_by);
    res.json({ success: true });
  }));

  // ─── Planning ───────────────────────────────────────

  app.post('/api/pipeline/:name/plan', safe((req, res) => {
    const result = pipeline.planTasks(req.params.name);
    if (result.planned) {
      broadcast(wss, { type: 'planStarted', data: { sessionName: req.params.name, tmuxSession: result.tmuxSession, wishIds: result.wishIds } });
    }
    res.json(result);
  }));

  app.get('/api/pipeline/:name/plan/status', safe((req, res) => {
    const result = pipeline.getPlanStatus(req.params.name);
    if (result.status === 'done' || result.status === 'error') {
      broadcast(wss, { type: 'planFinished', data: { sessionName: req.params.name, status: result.status, wishIds: result.wishIds } });
    }
    res.json(result);
  }));

  app.post('/api/pipeline/:name/apply-plan', safe((req, res) => {
    const { tasksJson } = req.body;
    const wishIds = Array.isArray(req.body.wishIds) ? req.body.wishIds : [];
    const result = pipeline.applyPlan(req.params.name, tasksJson, wishIds);
    if (result.success) {
      const tasks = pipeline.getTasks(req.params.name);
      broadcast(wss, { type: 'planApplied', data: { sessionName: req.params.name, ...result, tasks } });
    }
    res.json(result);
  }));

  // ─── Execution ──────────────────────────────────────

  app.post('/api/pipeline/:name/execute-interactive', safe((req, res) => {
    const { taskId, noWorktree } = req.body;
    const result = pipeline.executeTaskInteractive(req.params.name, taskId, { noWorktree });
    if (result.started) {
      broadcast(wss, { type: 'taskStarted', data: { sessionName: req.params.name, ...result } });
      ctx.bumpActivity(req.params.name);
    }
    res.json(result);
  }));

  app.post('/api/pipeline/:name/execute-silent', safe((req, res) => {
    const { taskId, noWorktree } = req.body;
    const result = pipeline.executeTaskSilent(req.params.name, taskId, { noWorktree });
    if (result.started) {
      broadcast(wss, { type: 'taskStarted', data: { sessionName: req.params.name, ...result } });
      ctx.bumpActivity(req.params.name);
    }
    res.json(result);
  }));

  app.get('/api/pipeline/:name/task-status/:taskId', safe((req, res) => {
    const taskId = parseInt(req.params.taskId);
    const result = pipeline.getTaskExecStatus(req.params.name, taskId);
    if (result.merge?.merged) {
      broadcast(wss, { type: 'taskMerged', data: { sessionName: req.params.name, taskId } });
    }
    res.json(result);
  }));

  app.get('/api/pipeline/:name/task-output/:taskId', safe((req, res) => {
    const output = pipeline.getTaskFullOutput(parseInt(req.params.taskId));
    res.json({ output });
  }));

  app.post('/api/pipeline/:name/execute', safe((req, res) => {
    const result = pipeline.executeNextTask(req.params.name);
    if (result.started) {
      broadcast(wss, { type: 'taskStarted', data: { sessionName: req.params.name, ...result } });
      ctx.bumpActivity(req.params.name);
    }
    res.json(result);
  }));

  app.get('/api/pipeline/:name/executions', safe((req, res) => {
    res.json(pipeline.getExecutionLog(req.params.name));
  }));

  // ─── Worktree / Merge ───────────────────────────────

  app.post('/api/pipeline/:name/tasks/:taskId/merge', safe((req, res) => {
    const taskId = parseInt(req.params.taskId);
    const { action } = req.body;
    const resolveAction = action || 'merge';

    const result = pipeline.resolveTaskMerge(taskId, resolveAction);

    if (result.success && result.merged) {
      broadcast(wss, { type: 'taskMerged', data: { sessionName: req.params.name, taskId } });
    } else if (result.success && !result.merged) {
      broadcast(wss, { type: 'taskMergeAborted', data: { sessionName: req.params.name, taskId } });
    } else if (result.conflictFiles) {
      broadcast(wss, {
        type: 'taskMergeConflict',
        data: { sessionName: req.params.name, taskId, conflictFiles: result.conflictFiles }
      });
    }

    res.json(result);
  }));

  app.get('/api/pipeline/:name/tasks/:taskId/diff', safe((req, res) => {
    const taskId = parseInt(req.params.taskId);
    const sess = config.findSession(req.params.name);
    if (!sess?.projectPath) return res.status(400).json({ error: 'No project path' });

    const repoRoot = worktree.getRepoRoot(sess.projectPath);
    if (!repoRoot) return res.status(400).json({ error: 'Not a git repository' });

    const branch = `csm/task-${taskId}`;

    try {
      const stat = execSync(`git diff --stat main...${branch}`, {
        cwd: repoRoot, stdio: 'pipe', encoding: 'utf8',
      }).trim();

      const lines = stat.split('\n');
      const summaryLine = lines[lines.length - 1] || '';
      const filesMatch = summaryLine.match(/(\d+)\s+files?\s+changed/);
      const insMatch = summaryLine.match(/(\d+)\s+insertions?\(\+\)/);
      const delMatch = summaryLine.match(/(\d+)\s+deletions?\(-\)/);

      res.json({
        files_changed: filesMatch ? parseInt(filesMatch[1]) : 0,
        insertions: insMatch ? parseInt(insMatch[1]) : 0,
        deletions: delMatch ? parseInt(delMatch[1]) : 0,
        summary: stat,
      });
    } catch (err) {
      res.json({ files_changed: 0, insertions: 0, deletions: 0, summary: '' });
    }
  }));

  app.post('/api/pipeline/:name/tasks/:taskId/open-terminal', safe((req, res) => {
    const taskId = parseInt(req.params.taskId);
    const wtPath = worktree.getWorktreePath(taskId);

    if (!fs.existsSync(wtPath)) {
      return res.status(404).json({ error: 'Worktree not found' });
    }

    try {
      platform.openTerminalInDir(wtPath);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));
};
