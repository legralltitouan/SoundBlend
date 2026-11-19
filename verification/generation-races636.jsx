/* Banc de test local, pas un point d'entrée de l'application. */
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DataProvider, useData } from '../src/context/DataContext.tsx';

export function Probe() {
  const data = useData();
  useEffect(() => { window.__generationData = () => data; });
  return <div id="ready">{data.authReady ? 'prêt' : 'préparation'}</div>;
}

createRoot(document.getElementById('root')).render(<DataProvider><Probe /></DataProvider>);
