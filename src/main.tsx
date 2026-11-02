import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import './index.css';

// Hosted with a password: if the session runs out, any API call answers 401 — go to the login page.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const res = await nativeFetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (res.status === 401 && url.includes('/api/') && !url.includes('/api/auth/')) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  return res;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
