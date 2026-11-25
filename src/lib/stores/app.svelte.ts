import type { Settings } from '../storage/idb';

export type ViewMode = 'editor' | 'split' | 'preview';

export class WorkspacePreferences {
  theme = $state<Settings['theme']>('system');
  prose = $state<Settings['prose']>('minimal');
  mode = $state<ViewMode>('split');
  sidebar = $state(true);
  split = $state(50);
  focus = $state(false);

  constructor(settings: Partial<Settings>) {
    this.theme = settings.theme ?? this.theme;
    this.prose = settings.prose ?? this.prose;
    this.mode = settings.mode ?? this.mode;
    this.sidebar = settings.sidebar ?? this.sidebar;
    this.split = settings.split ?? this.split;
  }
}
