import React, { useState, useEffect } from 'react';
import Auth from './components/Auth.jsx';
import Dashboard from './components/Dashboard.jsx';
import Analytics from './components/Analytics.jsx';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export default function App() {
  const [token, setToken] = useState(null);
  const [username, setUsername] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    const savedToken = localStorage.getItem('auth_token');
    const savedUsername = localStorage.getItem('user_username');
    if (savedToken && savedUsername) {
      setToken(savedToken);
      setUsername(savedUsername);
    }
  }, []);

  const handleAuthSuccess = (newToken, uname) => {
    setToken(newToken);
    setUsername(uname);
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_username');
    setToken(null);
    setUsername('');
    setActiveTab('dashboard');
  };

  if (!token) {
    return <Auth onAuthSuccess={handleAuthSuccess} apiBaseUrl={API_BASE_URL} />;
  }

  return (
    <div className="app-wrapper">
      <nav className="app-nav">
        <div className="nav-brand">get_social</div>

        <div className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            Studio
          </button>
          <button
            className={`nav-tab ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            Analytics
          </button>
        </div>

        <div className="nav-user">
          <span className="nav-email">@{username}</span>
          <button className="btn btn-secondary nav-logout" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </nav>

      <main className="app-main">
        {activeTab === 'dashboard' ? (
          <Dashboard token={token} apiBaseUrl={API_BASE_URL} />
        ) : (
          <Analytics token={token} apiBaseUrl={API_BASE_URL} />
        )}
      </main>
    </div>
  );
}