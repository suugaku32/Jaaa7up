import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  // Vite 8 vise par défaut safari16.4 / ios16.4. Un iPhone resté sur une version
  // antérieure ne sait alors pas analyser le bundle : erreur de syntaxe, rien ne
  // s'exécute, page blanche. On descend la cible pour couvrir les iOS plus anciens.
  build: {
    target: ['es2020', 'safari14', 'ios14', 'chrome87', 'firefox78', 'edge88'],
  },
  plugins: [react()],
})
