import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['lodash/throttle'],
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
