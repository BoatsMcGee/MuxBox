import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import './style.css';

// Configure Monaco Editor web workers for both Vite dev server and Electron.
// Uses getWorkerUrl (not getWorker) so Vite's dev server can resolve the URLs.
// The ?worker suffix tells Vite to handle these as web worker entries.
(self as unknown as Record<string, unknown>).MonacoEnvironment = {
    getWorkerUrl(_workerId: string, label: string) {
        switch (label) {
            case 'json':
                return new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url).href;
            case 'css':
            case 'scss':
            case 'less':
                return new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url).href;
            case 'html':
            case 'handlebars':
            case 'razor':
                return new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url).href;
            case 'typescript':
            case 'javascript':
                return new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url).href;
            default:
                return new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url).href;
        }
    },
};

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.mount('#app');
