import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/peachtober-2026/',
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
  ],
});
