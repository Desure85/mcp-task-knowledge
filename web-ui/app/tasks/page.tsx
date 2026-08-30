/**
 * web-ui/app/tasks/page.tsx — Tasks board (UI-001/UI-002)
 */

'use client';

import { useState, useEffect } from 'react';
import { api, type Task } from '@/lib/api-client';

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    try {
      setLoading(true);
      const data = await api.tasks.list();
      setTasks(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function createTask() {
    if (!newTitle.trim()) return;
    try {
      await api.tasks.create({ title: newTitle });
      setNewTitle('');
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

  const columns = ['pending', 'in_progress', 'completed', 'closed'] as const;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          New Task
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded">{error}</div>}

      {showCreate && (
        <div className="mb-4 flex gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Task title..."
            className="flex-1 px-3 py-2 border rounded"
            onKeyDown={(e) => e.key === 'Enter' && createTask()}
          />
          <button onClick={createTask} className="px-4 py-2 bg-green-600 text-white rounded">Create</button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {columns.map((col) => (
            <div key={col} className="bg-gray-100 rounded-lg p-3">
              <h2 className="font-semibold mb-3 capitalize">{col.replace('_', ' ')}</h2>
              <div className="space-y-2">
                {tasks.filter((t) => t.status === col).map((task) => (
                  <div key={task.id} className="bg-white p-3 rounded shadow-sm">
                    <p className="font-medium text-sm">{task.title}</p>
                    <div className="flex items-center gap-2 mt-2">
                      {task.priority && (
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          task.priority === 'high' ? 'bg-red-100 text-red-700' :
                          task.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{task.priority}</span>
                      )}
                      {task.status !== 'closed' && (
                        <button
                          onClick={() => closeTask(task.id)}
                          className="text-xs text-blue-600 hover:underline"
                        >Close</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
