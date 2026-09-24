import { createMemoryHistory, createRouter } from 'vue-router';
import LandingView from '@/views/LandingView.vue';
import ProjectView from '@/views/ProjectView.vue';
import SettingsView from '@/views/SettingsView.vue';
import SourceEditView from '@/views/SourceEditView.vue';

const routes = [
    { path: '/', name: 'landing', component: LandingView },
    { path: '/project/:id', name: 'project', component: ProjectView },
    { path: '/project/:id/source/new', name: 'source-new', component: SourceEditView },
    { path: '/project/:id/source/:sourceIdx', name: 'source-edit', component: SourceEditView },
    { path: '/settings', name: 'settings', component: SettingsView },
];

const router = createRouter({
    history: createMemoryHistory(),
    routes,
});

export default router;
