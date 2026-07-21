import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  server: {
    middlewareMode: true,
  },
  appType: 'spa',
});
