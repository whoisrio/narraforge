import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/global.css';
import { TryPage } from './TryPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TryPage />
  </StrictMode>,
);
