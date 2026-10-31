import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Sign-in is optional and cookie-based (see backend DashboardAuth). When the
// session ends — signed out on another device, password changed — every API
// call starts answering 401; reload once so the server serves the login form
// instead of leaving the kiosk showing stale tiles.
const nativeFetch = window.fetch.bind(window);
let reloadingForAuth = false;
window.fetch = async (...args) => {
  const r = await nativeFetch(...args);
  if (r.status === 401 && !reloadingForAuth) {
    reloadingForAuth = true;
    window.location.reload();
  }
  return r;
};

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
