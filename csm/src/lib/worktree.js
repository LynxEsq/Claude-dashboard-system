/**
 * Git Worktree utilities for task isolation
 *
 * Each pipeline task can run in its own git worktree,
 * so parallel tasks don't conflict with each other.
 * Worktrees are stored in ~/.csm/worktrees/ to keep project dirs clean.
 * For non-git projects, all functions return null (fallback to no worktree).
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const WORKTREES_DIR = path.join(os.homedir(), '.csm', 'worktrees');

/**
 * Check if a path is inside a git repository
 * @param {string} projectPath
 * @returns {boolean}
 */
function isGitRepo(projectPath) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: projectPath,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the root of the git repo for a given path
 * @param {string} projectPath
 * @returns {string|null}
 */
function getRepoRoot(projectPath) {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: projectPath,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the filesystem path for a task's worktree
 * @param {string|number} taskId
 * @returns {string}
 */
function getWorktreePath(taskId) {
  return path.join(WORKTREES_DIR, `task-${taskId}`);
}

/**
 * Create a git worktree for a pipeline task
 *
 * Creates a new worktree at ~/.csm/worktrees/task-{taskId}
 * on a new branch csm/task-{taskId} from the current HEAD.
 *
 * @param {string} projectPath — path to the project (or anywhere inside its git repo)
 * @param {string|number} taskId
 * @returns {{ worktreePath: string, branch: string }|null} — null if not a git repo
 */
function createWorktree(projectPath, taskId) {
  if (!isGitRepo(projectPath)) return null;

  const repoRoot = getRepoRoot(projectPath);
  if (!repoRoot) return null;

  const wtPath = getWorktreePath(taskId);
  const branch = `csm/task-${taskId}`;

  // Ensure parent directory exists
  fs.mkdirSync(WORKTREES_DIR, { recursive: true });

  // Remove stale worktree at this path if it exists
  if (fs.existsSync(wtPath)) {
    try {
      execSync(`git worktree remove --force ${JSON.stringify(wtPath)}`, {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } catch {
      // If git worktree remove fails, clean up manually
      fs.rmSync(wtPath, { recursive: true, force: true });
      try {
        execSync('git worktree prune', { cwd: repoRoot, stdio: 'pipe' });
      } catch { /* ignore */ }
    }
  }

  // Delete branch if it already exists (leftover from previous run)
  try {
    execSync(`git branch -D ${branch}`, { cwd: repoRoot, stdio: 'pipe' });
  } catch { /* branch didn't exist, fine */ }

  // Create worktree with a new branch from HEAD
  execSync(
    `git worktree add -b ${branch} ${JSON.stringify(wtPath)} HEAD`,
    { cwd: repoRoot, stdio: 'pipe' }
  );

  return { worktreePath: wtPath, branch };
}

/**
 * Delete a worktree and its branch (if merged)
 *
 * @param {string|number} taskId
 * @param {string} [projectPath] — needed to run git commands; if omitted, tries to infer from worktree
 * @returns {boolean} — true if successfully removed
 */
function deleteWorktree(taskId, projectPath) {
  const wtPath = getWorktreePath(taskId);
  const branch = `csm/task-${taskId}`;

  // Determine repo root: prefer the worktree itself, fall back to projectPath
  let repoRoot = null;
  if (fs.existsSync(wtPath)) {
    repoRoot = getRepoRoot(wtPath);
  }
  if (!repoRoot && projectPath) {
    repoRoot = getRepoRoot(projectPath);
  }
  if (!repoRoot) return false;

  // Remove the worktree
  try {
    execSync(`git worktree remove --force ${JSON.stringify(wtPath)}`, {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch {
    // Manual cleanup if git command fails
    if (fs.existsSync(wtPath)) {
      fs.rmSync(wtPath, { recursive: true, force: true });
    }
    try {
      execSync('git worktree prune', { cwd: repoRoot, stdio: 'pipe' });
    } catch { /* ignore */ }
  }

  // Delete the branch only if it has been merged
  try {
    execSync(`git branch -d ${branch}`, { cwd: repoRoot, stdio: 'pipe' });
  } catch {
    // -d fails if not merged — that's intentional, we don't force-delete
  }

  return true;
}

/**
 * List active CSM worktrees for a given project
 *
 * @param {string} projectPath
 * @returns {Array<{ taskId: string, path: string, branch: string }>|null} — null if not a git repo
 */
function listWorktrees(projectPath) {
  if (!isGitRepo(projectPath)) return null;

  const repoRoot = getRepoRoot(projectPath);
  if (!repoRoot) return null;

  let output;
  try {
    output = execSync('git worktree list --porcelain', {
      cwd: repoRoot,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch {
    return [];
  }

  const results = [];
  const entries = output.split('\n\n');

  for (const entry of entries) {
    const lines = entry.trim().split('\n');
    let wtPath = null;
    let branch = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        wtPath = line.slice('worktree '.length);
      } else if (line.startsWith('branch ')) {
        // branch refs/heads/csm/task-123
        branch = line.slice('branch '.length).replace('refs/heads/', '');
      }
    }

    // Only include CSM task worktrees
    if (wtPath && branch && branch.startsWith('csm/task-')) {
      const taskId = branch.replace('csm/task-', '');
      results.push({ taskId, path: wtPath, branch });
    }
  }

  return results;
}

module.exports = {
  isGitRepo,
  getRepoRoot,
  getWorktreePath,
  createWorktree,
  deleteWorktree,
  listWorktrees,
  WORKTREES_DIR,
};
