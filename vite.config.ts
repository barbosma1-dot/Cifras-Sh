import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
        devOptions: {
          enabled: false
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
          // Páginas litúrgicas externas (abertas em app via LiturgyViewer,
          // não em nova aba — só assim passam pelo service worker). Conteúdo
          // muda todo dia, então NetworkFirst: busca a versão de hoje quando
          // há internet (e atualiza o cache com ela); só cai para a última
          // cópia vista quando a rede falha/está offline. Um CacheFirst
          // "congelaria" no primeiro dia cacheado e nunca mais atualizaria.
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/liturgia\.cancaonova\.com\//,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'liturgia-cache',
                expiration: {
                  maxEntries: 15,
                  maxAgeSeconds: 7 * 24 * 60 * 60 // 7 dias
                },
                networkTimeoutSeconds: 8,
                cacheableResponse: { statuses: [0, 200] }
              }
            },
            {
              urlPattern: /^https:\/\/www\.catolicoorante\.com\.br\//,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'liturgia-cache',
                expiration: {
                  maxEntries: 15,
                  maxAgeSeconds: 7 * 24 * 60 * 60
                },
                networkTimeoutSeconds: 8,
                cacheableResponse: { statuses: [0, 200] }
              }
            },
            {
              urlPattern: /^https:\/\/www\.paulus\.com\.br\/portal\/liturgia-diaria-das-horas\//,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'liturgia-cache',
                expiration: {
                  maxEntries: 15,
                  maxAgeSeconds: 7 * 24 * 60 * 60
                },
                networkTimeoutSeconds: 8,
                cacheableResponse: { statuses: [0, 200] }
              }
            }
          ]
        },
        manifest: {
          name: 'Cifra SH',
          short_name: 'Cifra SH',
          description: 'Seu caderno de cifras inteligente',
          theme_color: '#f97316',
          icons: [
            {
              src: 'logo.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
