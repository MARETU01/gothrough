import path from 'node:path'
import { gzipSync } from 'node:zlib'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'GOTHROUGH_')
  return {
    plugins: [react(), tailwindcss(), {
      name: 'precompress-web-assets',
      apply: 'build',
      generateBundle: {
        order: 'post',
        handler(_, bundle) {
          for (const asset of Object.values(bundle)) {
            if (!/\.(js|css)$/.test(asset.fileName)) continue
            const source = asset.type === 'chunk' ? asset.code : asset.source
            const bytes = typeof source === 'string' ? Buffer.from(source) : source
            if (bytes.byteLength < 1024) continue
            const compressed = gzipSync(bytes, { level: 9 })
            if (compressed.byteLength >= bytes.byteLength) continue
            this.emitFile({ type: 'asset', fileName: `${asset.fileName}.gz`, source: compressed })
          }
        },
      },
    }],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            // Keep shared libraries separate from app changes. Leave other
            // modules to automatic splitting so lazy pages stay lazy.
            groups: [
              {
                name: 'vendor-react',
                test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                priority: 30,
              },
              {
                name: 'vendor-router',
                test: /[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/,
                priority: 20,
              },
              {
                name: 'vendor-i18n',
                test: /[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/,
                priority: 10,
              },
            ],
          },
        },
      },
    },
    server: {
      proxy: {
        '/api': {
          target: env.GOTHROUGH_DEV_API_TARGET || 'http://127.0.0.1:9815',
          // Preserve the browser-facing Host for the API's same-origin checks.
          changeOrigin: false,
        },
      },
    },
  }
})
