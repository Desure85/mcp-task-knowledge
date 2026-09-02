/**
 * web-ui/app/tasks/page.tsx — Tasks board (UI-002)
 *
 * Full Kanban board with:
 * - Drag & drop between status columns
 * - Search/filter by title, tags, priority
 * - Create, edit, close tasks
 * - Priority badges, tag chips
 * - Subtask indicator
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type Task } from '@/lib/api-client';

type Status = 'pending' | 'in_progress' | 'completed' | 'closed';
type Priority = 'low' | 'medium' | 'high';

const COLUMNS: { status: Status; label: string; color: string }[] = [
  { status: 'pending', label: 'Pending', color: 'bg-gray-100' },
  { status: 'in_progress', label: 'In Progress', color: 'bg-blue-50' },
  { status: 'completed', label: 'Completed', color: 'bg-green-50' },
  { status: 'closed', label: 'Closed', color: 'bg-gray-200' },
];

const PRIORITY_COLORS: Record<Priority, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  low: 'bg-gray-100 text-gray-600 border-gray-200',
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [newTags, setNewTags] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all');
  const [filterTag, setFilterTag] = useState<string>('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<Status | null>(null);
  const dragCounter = useRef(0);

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.tasks.list();
      setTasks(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  async function createTask() {
    if (!newTitle.trim()) return;
    try {
      const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean);
      await api.tasks.create({ title: newTitle, priority: newPriority, tags });
      setNewTitle('');
      setNewTags('');
      setNewPriority('medium');
      setShowCreate(false);
      await loadTasks();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function closeTask(id: string) {
    try {
      await api.tasks.close('mcp', id);
      await loadTasks();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function updateTaskStatus(id: string, status: Status) {
    try {
      await api.tasks.update('mcp', id, { status });
      await loadTasks();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveEdit() {
    if (!editingTask) return;
    try {
      await api.tasks.update('mcp', editingTask.id, {
        title: editingTask.title,
        priority: editingTask.priority,
        tags: editingTask.tags,
      });
      setEditingTask(null);
      await loadTasks();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent, col: Status) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(col);
  }

  function handleDragEnter() {
    dragCounter.current++;
  }

  function handleDragLeave() {
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOverCol(null);
  }

  function handleDrop(e: React.DragEvent, col: Status) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOverCol(null);
    if (draggedId) {
      void updateTaskStatus(draggedId, col);
      setDraggedId(null);
    }
  }

  const allTags = Array.from(new Set(tasks.flatMap((t) => t.tags ?? []))).sort();

  const filtered = tasks.filter((t) => {
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
    if (filterTag && !(t.tags ?? []).includes(filterTag)) return false;
    return true;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          + New Task
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500">✕</button>
        </div>
      )}

      {showCreate && (
        <div className="mb-4 p-4 bg-white rounded-lg shadow-sm border space-y-3">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Task title..."
            className="w-full px-3 py-2 border rounded-lg"
            onKeyDown={(e) => e.key === 'Enter' && createTask()}
            autoFocus
          />
          <div className="flex gap-3">
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as Priority)}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <input
              type="text"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="tags (comma-separated)"
              className="flex-1 px-3 py-2 border rounded-lg"
            />
            <button onClick={createTask} className="px-4 py-2 bg-green-600 text-white rounded-lg">Create</button>
          </div>
        </div>
      )}

      <div className="mb-4 flex gap-3 flex-wrap">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tasks..."
          className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg"
        />
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value as Priority | 'all')}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="all">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="">All tags</option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      </div>

      {editingTask && (
        <div className="mb-4 p-4 bg-white rounded-lg shadow-lg border-2 border-blue-300 space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold">Edit Task</h3>
            <button onClick={() => setEditingTask(null)} className="text-gray-400">✕</button>
          </div>
          <input
            type="text"
            value={editingTask.title}
            onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
          />
          <div className="flex gap-3">
            <select
              value={editingTask.priority}
              onChange={(e) => setEditingTask({ ...editingTask, priority: e.target.value as Priority })}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <input
              type="text"
              value={(editingTask.tags ?? []).join(', ')}
              onChange={(e) => setEditingTask({ ...editingTask, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              placeholder="tags"
              className="flex-1 px-3 py-2 border rounded-lg"
            />
            <button onClick={saveEdit} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Save</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {COLUMNS.map((col) => {
            const colTasks = filtered.filter((t) => t.status === col.status);
            return (
              <div
                key={col.status}
                className={`${col.color} rounded-lg p-3 min-h-[200px] transition ${dragOverCol === col.status ? 'ring-2 ring-blue-400' : ''}`}
                onDragOver={(e) => handleDragOver(e, col.status)}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.status)}
              >
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-sm">{col.label}</h2>
                  <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full">{colTasks.length}</span>
                </div>
                <div className="space-y-2">
                  {colTasks.map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      className={`bg-white p-3 rounded-lg shadow-sm cursor-move border ${draggedId === task.id ? 'opacity-50' : ''} hover:shadow-md transition`}
                    >
                      <p
                        className="font-medium text-sm cursor-pointer hover:text-blue-600"
                        onClick={() => setEditingTask({ ...task })}
                      >
                        {task.title}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className={`text-xs px-2 py-0.5 rounded border ${PRIORITY_COLORS[task.priority]}`}>
                          {task.priority}
                        </span>
                        {(task.tags ?? []).slice(0, 3).map((tag) => (
                          <span key={tag} className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                            {tag}
                          </span>
                        ))}
                        {(task.tags ?? []).length > 3 && (
                          <span className="text-xs text-gray-400">+{(task.tags ?? []).length - 3}</span>
                        )}
                      </div>
                      {task.parentId && (
                        <p className="text-xs text-gray-400 mt-1">↳ subtask</p>
                      )}
                      {col.status !== 'closed' && (
                        <button
                          onClick={() => closeTask(task.id)}
                          className="text-xs text-blue-600 hover:underline mt-2"
                        >
                          Close
                        </button>
                      )}
                    </div>
                  ))}
                  {colTasks.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-4">No tasks</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div className="mt-4 text-sm text-gray-500">
          Showing {filtered.length} of {tasks.length} tasks
        </div>
      )}
    </div>
  );
}
