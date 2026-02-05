import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { ProjectRegistry, ProjectInfo } from './types.js';

const MEMORY_PATH = join(homedir(), '.claude', 'cmem');
const REGISTRY_PATH = join(MEMORY_PATH, 'project-registry.json');

export class ProjectRegistryManager {
  private registry: ProjectRegistry;

  constructor() {
    this.registry = this.load();
  }

  private load(): ProjectRegistry {
    if (existsSync(REGISTRY_PATH)) {
      const content = readFileSync(REGISTRY_PATH, 'utf-8');
      return JSON.parse(content);
    }
    return { projects: {} };
  }

  private save(): void {
    writeFileSync(REGISTRY_PATH, JSON.stringify(this.registry, null, 2));
  }

  detectProject(cwd?: string): string | null {
    const currentPath = resolve(cwd || process.cwd());

    for (const [projectName, info] of Object.entries(this.registry.projects)) {
      for (const projectPath of info.paths) {
        const expandedPath = projectPath.replace(/^~/, homedir());
        const resolvedPath = resolve(expandedPath);

        if (currentPath.startsWith(resolvedPath)) {
          return projectName;
        }
      }
    }

    return null;
  }

  createProject(name: string, path?: string, description?: string): void {
    if (this.registry.projects[name]) {
      throw new Error(`Project '${name}' already exists`);
    }

    const projectPath = resolve(path || process.cwd());

    this.registry.projects[name] = {
      paths: [projectPath],
      description: description || `Project ${name}`,
      createdAt: Date.now()
    };

    this.save();
  }

  addPath(name: string, path: string): void {
    if (!this.registry.projects[name]) {
      throw new Error(`Project '${name}' not found`);
    }

    const resolvedPath = resolve(path);

    if (this.registry.projects[name].paths.includes(resolvedPath)) {
      throw new Error(`Path already registered for '${name}'`);
    }

    this.registry.projects[name].paths.push(resolvedPath);
    this.save();
  }

  deleteProject(name: string): void {
    if (!this.registry.projects[name]) {
      throw new Error(`Project '${name}' not found`);
    }

    delete this.registry.projects[name];
    this.save();
  }

  getProject(name: string): ProjectInfo | null {
    return this.registry.projects[name] || null;
  }

  listProjects(): Array<{ name: string; info: ProjectInfo }> {
    return Object.entries(this.registry.projects).map(([name, info]) => ({
      name,
      info
    }));
  }

  updateDescription(name: string, description: string): void {
    if (!this.registry.projects[name]) {
      throw new Error(`Project '${name}' not found`);
    }

    this.registry.projects[name].description = description;
    this.save();
  }
}
