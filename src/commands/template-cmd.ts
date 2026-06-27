import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface Template {
  name: string;
  description: string;
  files: TemplateFile[];
}

export interface TemplateFile {
  path: string;
  content: string;
}

export const BUILT_IN_TEMPLATES: Template[] = [
  {
    name: 'node-ts',
    description: 'Basic Node.js + TypeScript project scaffold.',
    files: [
      {
        path: 'package.json',
        content: `${JSON.stringify(
          {
            name: 'node-ts-app',
            version: '1.3.0',
            private: true,
            type: 'module',
            scripts: {
              build: 'tsc -p .',
              dev: 'tsx src/index.ts',
              start: 'node dist/index.js',
            },
            devDependencies: {
              '@types/node': '^22.0.0',
              tsx: '^4.0.0',
              typescript: '^5.0.0',
            },
          },
          null,
          2,
        )}\n`,
      },
      {
        path: 'tsconfig.json',
        content: `${JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ES2022',
              moduleResolution: 'Bundler',
              outDir: 'dist',
              rootDir: 'src',
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
            },
            include: ['src/**/*.ts'],
          },
          null,
          2,
        )}\n`,
      },
      {
        path: 'src/index.ts',
        content: `export function main(): void {
  console.log('Hello from node-ts');
}

main();
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
dist
.env
`,
      },
    ],
  },
  {
    name: 'express-api',
    description: 'Express REST API with route and middleware skeletons.',
    files: [
      {
        path: 'package.json',
        content: `${JSON.stringify(
          {
            name: 'express-api',
            version: '1.3.0',
            private: true,
            type: 'module',
            scripts: {
              build: 'tsc -p .',
              dev: 'tsx watch src/index.ts',
              start: 'node dist/index.js',
            },
            dependencies: {
              express: '^4.19.2',
            },
            devDependencies: {
              '@types/express': '^5.0.0',
              '@types/node': '^22.0.0',
              tsx: '^4.0.0',
              typescript: '^5.0.0',
            },
          },
          null,
          2,
        )}\n`,
      },
      {
        path: 'tsconfig.json',
        content: `${JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ES2022',
              moduleResolution: 'Bundler',
              outDir: 'dist',
              rootDir: 'src',
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
            },
            include: ['src/**/*.ts'],
          },
          null,
          2,
        )}\n`,
      },
      {
        path: 'src/index.ts',
        content: `import express from 'express';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/error.js';

const app = express();

app.use(express.json());
app.use('/api', apiRouter);
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(\`API listening on http://localhost:\${port}\`);
});
`,
      },
      {
        path: 'src/routes/index.ts',
        content: `import { Router } from 'express';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});
`,
      },
      {
        path: 'src/middleware/error.ts',
        content: `import type { NextFunction, Request, Response } from 'express';

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error(error);
  res.status(500).json({ error: 'Internal Server Error' });
}
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
dist
.env
`,
      },
    ],
  },
  {
    name: 'cli-tool',
    description: 'Commander-powered CLI tool scaffold.',
    files: [
      {
        path: 'package.json',
        content: `${JSON.stringify(
          {
            name: 'cli-tool',
            version: '1.3.0',
            private: true,
            type: 'module',
            bin: {
              'cli-tool': './bin/cli.js',
            },
            scripts: {
              build: 'tsc -p .',
              dev: 'tsx src/cli.ts',
              start: 'node bin/cli.js',
            },
            dependencies: {
              commander: '^12.1.0',
            },
            devDependencies: {
              '@types/node': '^22.0.0',
              tsx: '^4.0.0',
              typescript: '^5.0.0',
            },
          },
          null,
          2,
        )}\n`,
      },
      {
        path: 'tsconfig.json',
        content: `${JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ES2022',
              moduleResolution: 'Bundler',
              outDir: 'dist',
              rootDir: 'src',
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
            },
            include: ['src/**/*.ts'],
          },
          null,
          2,
        )}\n`,
      },
      {
        path: 'bin/cli.js',
        content: `#!/usr/bin/env node
import '../dist/cli.js';
`,
      },
      {
        path: 'src/cli.ts',
        content: `import { Command } from 'commander';

const program = new Command();

program
  .name('cli-tool')
  .description('A starter CLI built with commander')
  .version('1.3.0');

program
  .command('hello')
  .description('Print a greeting')
  .action(() => {
    console.log('Hello from cli-tool');
  });

program.parse();
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
dist
`,
      },
    ],
  },
  {
    name: 'react-vite',
    description: 'React + Vite starter scaffold.',
    files: [
      {
        path: 'package.json',
        content: `${JSON.stringify(
          {
            name: 'react-vite-app',
            version: '1.3.0',
            private: true,
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'tsc -p . && vite build',
              preview: 'vite preview',
            },
            dependencies: {
              react: '^18.3.1',
              'react-dom': '^18.3.1',
            },
            devDependencies: {
              '@types/react': '^18.3.3',
              '@types/react-dom': '^18.3.0',
              '@vitejs/plugin-react': '^4.3.1',
              typescript: '^5.5.4',
              vite: '^5.4.0',
            },
          },
          null,
          2,
        )}\n`,
      },
      {
        path: 'tsconfig.json',
        content: `${JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2020',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              jsx: 'react-jsx',
              strict: true,
              skipLibCheck: true,
              noEmit: true,
            },
            include: ['src'],
          },
          null,
          2,
        )}\n`,
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,
      },
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React + Vite</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: 'src/main.tsx',
        content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,
      },
      {
        path: 'src/App.tsx',
        content: `export default function App(): JSX.Element {
  return (
    <main>
      <h1>React + Vite</h1>
      <p>Start building your app.</p>
    </main>
  );
}
`,
      },
      {
        path: '.gitignore',
        content: `node_modules
dist
`,
      },
    ],
  },
  {
    name: 'python-fastapi',
    description: 'FastAPI starter scaffold for Python services.',
    files: [
      {
        path: 'main.py',
        content: `from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}
`,
      },
      {
        path: 'requirements.txt',
        content: `fastapi==0.115.0
uvicorn[standard]==0.30.6
`,
      },
      {
        path: '.gitignore',
        content: `__pycache__/
.venv/
*.pyc
`,
      },
    ],
  },
];

export function listTemplates(): string {
  const lines = BUILT_IN_TEMPLATES.map(
    (template) => `  ${theme.ok(template.name)}  ${theme.dim(`- ${template.description}`)}`,
  );

  return `${theme.brand('Available templates')}\n${lines.join('\n')}\n`;
}

export function previewTemplate(name: string): string {
  const template = findTemplate(name);
  if (!template) {
    return `${theme.warn(`Unknown template: ${name}`)}\n${theme.dim(
      `Available templates: ${BUILT_IN_TEMPLATES.map((entry) => entry.name).join(', ')}`,
    )}\n`;
  }

  return `${theme.brand(`Template: ${template.name}`)}\n${theme.dim(template.description)}\n\n${renderFileTree(
    template.files,
  )}\n`;
}

export function templateCommand(args: string[]): string {
  const name = args.find((arg) => !arg.startsWith('--'));
  const apply = args.includes('--apply');

  if (!name) {
    return listTemplates();
  }

  const template = findTemplate(name);
  if (!template) {
    return previewTemplate(name);
  }

  if (!apply) {
    return `${previewTemplate(name)}\n${theme.dim(
      `Use /template ${name} --apply to create these files in ${resolveTargetDir()}.`,
    )}\n`;
  }

  const targetDir = resolveTargetDir();
  if (!confirmTemplateApply(template, targetDir)) {
    return `${theme.warn('Template apply cancelled.')}\n`;
  }

  const writtenFiles = applyTemplate(template, targetDir);
  const summary = writtenFiles
    .map((filePath) => `  ${theme.ok('created')} ${theme.hl(filePath)}`)
    .join('\n');
  return `${theme.ok(`Created ${writtenFiles.length} file(s) from ${template.name}.`)}\n${summary}\n`;
}

function findTemplate(name: string): Template | undefined {
  return BUILT_IN_TEMPLATES.find((template) => template.name === name);
}

function resolveTargetDir(): string {
  return path.resolve(config.cwd || process.cwd());
}

function confirmTemplateApply(template: Template, targetDir: string): boolean {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const existingCount = template.files.filter((file) =>
    fs.existsSync(path.join(targetDir, ...file.path.split('/'))),
  ).length;
  const message = `Apply template "${template.name}" in ${targetDir}? This will write ${template.files.length} file(s)${
    existingCount > 0 ? ` and overwrite ${existingCount} existing file(s)` : ''
  }. [y/N] `;
  const script = [
    "const readline = require('node:readline');",
    'const rl = readline.createInterface({ input: process.stdin, output: process.stdout });',
    `rl.question(${JSON.stringify(message)}, (answer) => {`,
    '  rl.close();',
    '  process.exit(/^(y|yes)$/i.test(String(answer).trim()) ? 0 : 1);',
    '});',
  ].join('\n');

  const result = spawnSync(process.execPath, ['-e', script], { stdio: 'inherit' });
  return result.status === 0;
}

function applyTemplate(template: Template, targetDir: string): string[] {
  const writtenFiles: string[] = [];

  for (const file of template.files) {
    const filePath = path.join(targetDir, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, file.content, 'utf8');
    writtenFiles.push(path.relative(targetDir, filePath) || file.path);
  }

  return writtenFiles;
}

function renderFileTree(files: TemplateFile[]): string {
  const root = createTreeNode('');
  const sortedPaths = [...files]
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right));

  for (const filePath of sortedPaths) {
    let node = root;
    for (const segment of filePath.split('/')) {
      let child = node.children.get(segment);
      if (!child) {
        child = createTreeNode(segment);
        node.children.set(segment, child);
      }
      node = child;
    }
  }

  return renderTreeChildren(root, '');
}

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
}

function createTreeNode(name: string): TreeNode {
  return { name, children: new Map<string, TreeNode>() };
}

function renderTreeChildren(node: TreeNode, prefix: string): string {
  const children = [...node.children.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  return children
    .map((child, index) => {
      const isLast = index === children.length - 1;
      const branch = `${prefix}${isLast ? '└─ ' : '├─ '}`;
      const nextPrefix = `${prefix}${isLast ? '   ' : '│  '}`;
      const label = child.children.size > 0 ? `${child.name}/` : child.name;
      const nested = child.children.size > 0 ? `\n${renderTreeChildren(child, nextPrefix)}` : '';
      return `  ${theme.hl(branch + label)}${nested}`;
    })
    .join('\n');
}
