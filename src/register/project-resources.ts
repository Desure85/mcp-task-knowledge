import type { ServerContext } from './context.js';
import { getCurrentProject, setCurrentProject } from '../config.js';
import { listProjects } from '../projects.js';

export function registerProjectResources(ctx: ServerContext): void {
  try {
    ctx.server.registerResource(
      "project_current",
      "project://current",
      {
        title: "Current Project",
        description: "Return the current project context",
        mimeType: "application/json",
      },
      async (uri) => {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify({ project: getCurrentProject() }, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
    );
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (typeof msg === 'string' && msg.includes('already registered')) {
      console.warn('[resources] already registered: project://current — skipping');
    } else {
      throw e;
    }
  }

  try {
    ctx.server.registerResource(
      'project_use_tpl',
      ctx.makeResourceTemplate('project://use/{project}'),
      {
        title: 'Use Project',
        description: 'Switch current project to the given project id',
        mimeType: 'application/json',
      },
      async (u: URL, vars: any) => {
        const pid = String(vars?.project || '').trim();
        const next = setCurrentProject(pid);
        return { contents: [{ uri: u.href, text: JSON.stringify({ project: next }, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e) {
    console.warn('[resources] failed to register project use template:', e);
  }

  try {
    ctx.server.registerResource(
      'project_list',
      'project://projects',
      {
        title: 'Projects List',
        description: 'List known projects (current/default flags included)',
        mimeType: 'application/json',
      },
      async (u) => {
        const data = await listProjects(getCurrentProject);
        return { contents: [{ uri: u.href, text: JSON.stringify(data, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (typeof msg === 'string' && msg.includes('already registered')) {
      console.warn('[resources] already registered: project://projects — skipping');
    } else { throw e; }
  }
}
