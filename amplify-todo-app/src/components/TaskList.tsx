import { useEffect, useState } from 'react';
import { listTasks, createTask, deleteTask, type Task } from '../utils/tasksApi';
import TaskForm from './TaskForm';

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadTasks() {
    setLoading(true);
    setError(null);
    try {
      const data = await listTasks();
      setTasks(data);
    } catch (e) {
      setError('Failed to load tasks. Make sure the backend is deployed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTasks();
  }, []);

  async function handleCreate(title: string, description: string) {
    const task = await createTask(title, description || undefined);
    setTasks((prev) => [task, ...prev]);
  }

  async function handleDelete(taskId: string) {
    await deleteTask(taskId);
    setTasks((prev) => prev.filter((t) => t.taskId !== taskId));
  }

  return (
    <section className="panel">
      <h2>Ad-hoc Tasks</h2>
      <p className="muted hint">Managed via API Gateway + DynamoDB</p>
      <TaskForm onSubmit={handleCreate} />

      {loading ? (
        <p className="muted">Loading…</p>
      ) : error ? (
        <p className="error">{error}</p>
      ) : tasks.length === 0 ? (
        <p className="muted">No tasks yet. Add one above.</p>
      ) : (
        <ul className="item-list">
          {tasks.map((task) => (
            <li key={task.taskId} className="item">
              <div className="item-label">
                <span className="item-title">{task.title}</span>
                {task.description && (
                  <span className="item-desc">{task.description}</span>
                )}
                <span className="item-meta">
                  {new Date(task.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="item-actions">
                <button
                  className="icon-btn danger"
                  onClick={() => handleDelete(task.taskId)}
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
