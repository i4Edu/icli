import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkflowEngine, type WorkflowDef } from '../../src/workflows/engine.js';

describe('WorkflowEngine', () => {
  let projectDir: string;

  beforeEach(() => {
    fs.mkdirSync(path.join(process.cwd(), '.vitest-workflow-engine'), { recursive: true });
    projectDir = fs.mkdtempSync(path.join(process.cwd(), '.vitest-workflow-engine', 'case-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('loads workflow YAML files from .icopilot/workflows', () => {
    const workflowDir = path.join(projectDir, '.icopilot', 'workflows');
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(
      path.join(workflowDir, 'sample.yaml'),
      [
        'name: sample',
        'description: Sample workflow',
        'steps:',
        '  - id: prompt-step',
        '    name: Prompt step',
        "    action: prompt",
        '    params:',
        "      prompt: Hello workflow",
        '',
      ].join('\n'),
      'utf8',
    );

    const engine = new WorkflowEngine({ cwd: projectDir });
    const workflows = engine.loadWorkflows(projectDir);

    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.name).toBe('sample');
    expect(workflows[0]?.steps[0]?.action).toBe('prompt');
  });

  it('reports validation errors for malformed workflows', () => {
    const engine = new WorkflowEngine({ cwd: projectDir });
    const errors = engine.validateWorkflow({
      name: '',
      description: '',
      steps: [
        {
          id: '',
          name: '',
          action: 'invalid' as never,
          params: [],
        },
      ],
      triggers: [{ type: 'invalid' as never, config: [] as never }],
    });

    expect(errors.map((error) => error.path)).toEqual(
      expect.arrayContaining([
        'name',
        'description',
        'steps[0].id',
        'steps[0].name',
        'steps[0].action',
        'steps[0].params',
        'triggers[0].type',
        'triggers[0].config',
      ]),
    );
  });

  it('runs workflows with interpolation, conditions, and loops', async () => {
    const engine = new WorkflowEngine({ cwd: projectDir });
    const workflow: WorkflowDef = {
      name: 'demo',
      description: 'Demo workflow',
      steps: [
        {
          id: 'emit',
          name: 'Emit output',
          action: 'command',
          params: {
            command: process.execPath,
            args: ['-e', 'process.stdout.write("alpha")'],
          },
        },
        {
          id: 'prompt',
          name: 'Interpolate previous output',
          action: 'prompt',
          params: {
            prompt: 'value=${prev.output}',
          },
        },
        {
          id: 'branch',
          name: 'Branch on output',
          action: 'condition',
          params: {
            if: '${steps.emit.output}',
            then: [
              {
                id: 'then-step',
                name: 'Then prompt',
                action: 'prompt',
                params: {
                  prompt: 'then:${prev.output}',
                },
              },
            ],
          },
        },
        {
          id: 'loop',
          name: 'Loop over items',
          action: 'loop',
          params: {
            items: ['one', 'two'],
            steps: [
              {
                id: 'loop-step',
                name: 'Loop prompt',
                action: 'prompt',
                params: {
                  prompt: 'item=${loop.item}',
                },
              },
            ],
          },
        },
      ],
    };

    const result = await engine.run(workflow, { cwd: projectDir });

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(4);
    expect(result.steps[0]).toMatchObject({ stepId: 'emit', success: true, output: 'alpha' });
    expect(result.steps[1]).toMatchObject({ stepId: 'prompt', success: true, output: 'value=alpha' });
    expect(result.steps[2]?.output).toMatchObject({
      passed: true,
      branch: 'then',
    });
    expect(result.steps[2]?.output.steps[0]).toMatchObject({
      stepId: 'then-step',
      output: 'then:value=alpha',
    });
    expect(result.steps[3]?.output).toHaveLength(2);
    expect(result.steps[3]?.output[0]?.steps[0]).toMatchObject({ output: 'item=one' });
    expect(result.steps[3]?.output[1]?.steps[0]).toMatchObject({ output: 'item=two' });
  });
});
