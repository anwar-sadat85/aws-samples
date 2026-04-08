import { fetchAuthSession } from 'aws-amplify/auth';
import outputs from '../../amplify_outputs.json';

// The API URL comes from the Amplify custom outputs written by backend.ts
const API_URL = (outputs as { custom?: { tasksApiUrl?: string } }).custom
  ?.tasksApiUrl?.replace(/\/$/, '');

export interface Task {
  taskId: string;
  userId: string;
  title: string;
  description?: string;
  createdAt: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  return {
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : '',
  };
}

export async function listTasks(): Promise<Task[]> {
  const res = await fetch(`${API_URL}/tasks`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to list tasks');
  return res.json();
}

export async function createTask(
  title: string,
  description?: string
): Promise<Task> {
  const res = await fetch(`${API_URL}/tasks`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ title, description }),
  });
  if (!res.ok) throw new Error('Failed to create task');
  return res.json();
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`${API_URL}/tasks/${taskId}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete task');
}
