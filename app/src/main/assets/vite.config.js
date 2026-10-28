import { defineConfig } from 'vite';

// base './' keeps asset paths relative so the app works inside an Android WebView
export default defineConfig({ base: './' });
