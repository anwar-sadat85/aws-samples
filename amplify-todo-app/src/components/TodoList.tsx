import { useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import TodoForm from './TodoForm';

type Todo = Schema['Todo']['type'];

const client = generateClient<Schema>();

export default function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function loadTodos() {
    setLoading(true);
    try {
      const { data } = await client.models.Todo.list();
      setTodos(data.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTodos();
    // Real-time subscription
    const sub = client.models.Todo.observeQuery().subscribe({
      next: ({ items }) =>
        setTodos([...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    });
    return () => sub.unsubscribe();
  }, []);

  async function handleCreate(title: string, description: string) {
    await client.models.Todo.create({ title, description, completed: false });
  }

  async function handleToggle(todo: Todo) {
    await client.models.Todo.update({ id: todo.id, completed: !todo.completed });
  }

  async function handleEdit(id: string, title: string, description: string) {
    await client.models.Todo.update({ id, title, description });
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    await client.models.Todo.delete({ id });
  }

  return (
    <section className="panel">
      <h2>Todos</h2>
      <TodoForm onSubmit={handleCreate} submitLabel="Add Todo" />

      {loading ? (
        <p className="muted">Loading…</p>
      ) : todos.length === 0 ? (
        <p className="muted">No todos yet. Add one above.</p>
      ) : (
        <ul className="item-list">
          {todos.map((todo) => (
            <li key={todo.id} className={`item ${todo.completed ? 'done' : ''}`}>
              {editingId === todo.id ? (
                <TodoForm
                  initialTitle={todo.title}
                  initialDescription={todo.description ?? ''}
                  submitLabel="Save"
                  onSubmit={(t, d) => handleEdit(todo.id, t, d)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <label className="item-label">
                    <input
                      type="checkbox"
                      checked={todo.completed ?? false}
                      onChange={() => handleToggle(todo)}
                    />
                    <span className="item-title">{todo.title}</span>
                    {todo.description && (
                      <span className="item-desc">{todo.description}</span>
                    )}
                  </label>
                  <div className="item-actions">
                    <button
                      className="icon-btn"
                      onClick={() => setEditingId(todo.id)}
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={() => handleDelete(todo.id)}
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
