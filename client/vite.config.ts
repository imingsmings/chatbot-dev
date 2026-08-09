import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'markdown',
              priority: 3,
              test: /node_modules[\\/](dompurify|highlight\.js|markdown-it)[\\/]/,
            },
            {
              name: 'ui',
              priority: 2,
              test: /node_modules[\\/](@base-ui|lucide-react)[\\/]/,
            },
            {
              name: 'react',
              priority: 1,
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:7001',
        changeOrigin: true,
      },
    },
  },
})
