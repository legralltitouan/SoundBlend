import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'node:path'

// https://vite.dev/config/
/* L'app est servie soit à la racine d'un domaine (Cloudflare Pages,
   Netlify, Vercel), soit dans un sous-dossier (GitHub Pages range les
   projets dans /<compte>/<dépôt>/). `BASE_PATH` permet de compiler pour
   ce sous-dossier sans toucher au reste :

     BASE_PATH=/soundblend/ npm run build

   Par défaut, la racine — c'est le cas de tous les hébergeurs sauf
   GitHub Pages. */
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    host: '0.0.0.0',
    // 5173 : le port accepté par la clé YouTube par défaut (restriction de référent)
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  build: { target: 'es2020' },
})
