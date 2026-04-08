import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import TodoList from './components/TodoList';
import TaskList from './components/TaskList';

export default function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <div className="app">
          <header className="app-header">
            <h1>Todo & Tasks</h1>
            <div className="header-right">
              <span className="user-email">{user?.signInDetails?.loginId}</span>
              <button onClick={signOut} className="secondary sign-out-btn">
                Sign out
              </button>
            </div>
          </header>

          <main className="app-main">
            <TodoList />
            <TaskList />
          </main>
        </div>
      )}
    </Authenticator>
  );
}
