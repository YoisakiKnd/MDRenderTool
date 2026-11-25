import { mount } from 'svelte';
import App from './App.svelte';
import { getSettings } from './lib/storage/idb';
import './app.css';

const target = document.getElementById('app');
if (!target) throw new Error('MDRenderTool requires its mount element');

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
void getSettings().catch(() => ({})).then((settings) => {
  mount(App, { target, props: { settings, systemTheme } });
});
