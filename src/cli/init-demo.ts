/** DX-26b: `init --demo` seeds a small, obviously-sample project. */

export const INIT_USAGE = `Usage: node dist/index.js init --demo [--project <id>]

  --demo              create a sample project with tasks and a knowledge doc
  --project <id>      project id (default: demo)
`;

interface InitArgs {
  demo: boolean;
  project: string;
  help: boolean;
}

function parse(argv: string[]): InitArgs | string {
  let demo = false;
  let project = 'demo';
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { help = true; continue; }
    if (arg === '--demo') { demo = true; continue; }
    if (arg === '--project') {
      const value = argv[++i];
      if (!value) return 'missing value for --project';
      project = value;
      continue;
    }
    if (arg.startsWith('--project=')) {
      project = arg.slice('--project='.length);
      continue;
    }
    return `unknown argument: ${arg}`;
  }
  return { demo, project, help };
}

export async function runInitCli(argv: string[]): Promise<number> {
  const parsed = parse(argv);
  if (typeof parsed === 'string') {
    process.stderr.write(`init: ${parsed}\n${INIT_USAGE}`);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(INIT_USAGE);
    return 0;
  }
  if (!parsed.demo) {
    process.stderr.write(`init: only --demo is supported\n${INIT_USAGE}`);
    return 2;
  }

  try {
    const { createProject } = await import('../projects.js');
    const { createTask } = await import('../storage/tasks.js');
    const { createDoc } = await import('../storage/knowledge.js');

    const project = parsed.project;
    const { readProjectMetadata } = await import('../projects.js');
    if (await readProjectMetadata(project)) {
      throw new Error(`project '${project}' already exists; choose another id or delete it first`);
    }
    await createProject(project, 'Demo project created by `init --demo`');
    const first = await createTask({
      project,
      title: 'Welcome to the demo project',
      description: 'This task was seeded by `mcp-task-knowledge init --demo`.',
      priority: 'high',
      tags: ['demo', 'welcome'],
    });
    await createTask({
      project,
      title: 'Try the task workflow',
      description: 'Move this task through the configured statuses, then close it.',
      parentId: first.id,
      tags: ['demo'],
    });
    await createDoc({
      project,
      title: 'Demo knowledge doc',
      content: '# Demo\n\nThis document was seeded by `init --demo`.\n',
      tags: ['demo'],
    });
    process.stdout.write(`init: demo project '${project}' created with 2 tasks and 1 document\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`init: ${(error as Error).message}\n`);
    process.stderr.write('hint: set DATA_DIR to a writable directory and use a new project id\n');
    return 1;
  }
}
