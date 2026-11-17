import type {Plugin} from 'siyuan';

/** Modules share the sole host Plugin; no extra Plugin instances or registrations. */
export class ModuleContext {
  constructor(protected readonly owner: Plugin) {}
  get name() { return this.owner.name; }
  get app() { return this.owner.app; }
  get eventBus() { return this.owner.eventBus; }
  get commands() { return this.owner.commands; }
  addIcons: Plugin['addIcons'] = (...args) => this.owner.addIcons(...args);
  addTab: Plugin['addTab'] = (...args) => this.owner.addTab(...args);
  addDock: Plugin['addDock'] = (...args) => this.owner.addDock(...args);
  removeDock: Plugin['removeDock'] = (...args) => this.owner.removeDock(...args);
  addCommand: Plugin['addCommand'] = (...args) => this.owner.addCommand(...args);
}
