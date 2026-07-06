import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { theme } from '../ui/theme.js';

export type DocumentArtifactType = 'adr' | 'api-doc' | 'changelog' | 'readme' | 'release-notes';
export type ADRStatus = 'proposed' | 'accepted' | 'deprecated' | 'superseded';

export interface DocumentArtifact {
  type: DocumentArtifactType;
  path: string;
  content: string;
  generatedAt: string;
  sourceContext?: string;
}

export interface DocumentationConfig {
  outputDir: string;
  formats: string[];
  autoGenerate: boolean;
  templates?: Record<string, string>;
}

export interface ADR {
  id: string;
  title: string;
  status: ADRStatus;
  context: string;
  decision: string;
  consequences: string;
  date: string;
}

export class SelfDocumenter {
  private readonly artifacts: DocumentArtifact[] = [];
  private readonly config: DocumentationConfig;

  constructor(config?: Partial<DocumentationConfig>) {
    this.config = {
      outputDir: config?.outputDir ?? 'docs/delivery',
      formats: config?.formats?.length ? [...config.formats] : ['md'],
      autoGenerate: config?.autoGenerate ?? true,
      templates: config?.templates ? { ...config.templates } : undefined,
    };
  }

  generateADR(
    context:
      | string
      | {
          title?: string;
          status?: ADRStatus;
          context: string;
          decision?: string;
          consequences?: string;
        },
  ): ADR {
    const input = typeof context === 'string' ? { context } : context;
    const adr: ADR = {
      id: randomUUID(),
      title: input.title ?? 'Architecture decision record',
      status: input.status ?? 'proposed',
      context: input.context,
      decision: input.decision ?? 'Decision pending.',
      consequences: input.consequences ?? 'Consequences to be evaluated.',
      date: new Date().toISOString(),
    };

    this.artifacts.push({
      type: 'adr',
      path: path.join(this.config.outputDir, `adr-${adr.id}.md`),
      content: formatADR(adr),
      generatedAt: adr.date,
      sourceContext: adr.context,
    });

    return structuredClone(adr);
  }

  generateAPIDocs(sourcePaths: string[]): DocumentArtifact {
    const generatedAt = new Date().toISOString();
    const content = [
      '# API Documentation',
      '',
      ...sourcePaths.map((sourcePath) => `- ${sourcePath}`),
    ].join('\n');
    return this.recordArtifact({
      type: 'api-doc',
      path: path.join(this.config.outputDir, 'api-docs.md'),
      content,
      generatedAt,
      sourceContext: sourcePaths.join(', '),
    });
  }

  generateChangelog(fromRef: string, toRef: string): DocumentArtifact {
    const generatedAt = new Date().toISOString();
    const content = ['# Changelog', '', `- Range: ${fromRef} -> ${toRef}`].join('\n');
    return this.recordArtifact({
      type: 'changelog',
      path: path.join(this.config.outputDir, `changelog-${sanitizeName(toRef)}.md`),
      content,
      generatedAt,
      sourceContext: `${fromRef}:${toRef}`,
    });
  }

  generateReleaseNotes(version: string): DocumentArtifact {
    const generatedAt = new Date().toISOString();
    const content = ['# Release Notes', '', `Version: ${version}`].join('\n');
    return this.recordArtifact({
      type: 'release-notes',
      path: path.join(this.config.outputDir, `release-${sanitizeName(version)}.md`),
      content,
      generatedAt,
      sourceContext: version,
    });
  }

  listArtifacts(): DocumentArtifact[] {
    return this.artifacts.map((artifact) => structuredClone(artifact));
  }

  getConfig(): DocumentationConfig {
    return {
      outputDir: this.config.outputDir,
      formats: [...this.config.formats],
      autoGenerate: this.config.autoGenerate,
      templates: this.config.templates ? { ...this.config.templates } : undefined,
    };
  }

  private recordArtifact(artifact: DocumentArtifact): DocumentArtifact {
    this.artifacts.push(structuredClone(artifact));
    return structuredClone(artifact);
  }
}

export function formatADR(adr: ADR): string {
  return [
    `${theme.badge('ADR')} ${theme.hl(adr.title)}`,
    `${theme.dim('status')} ${adr.status}`,
    `${theme.dim('date')} ${adr.date}`,
    '',
    adr.context,
    '',
    adr.decision,
    '',
    adr.consequences,
  ].join('\n');
}

export function formatDocumentList(artifacts: DocumentArtifact[]): string {
  if (!artifacts.length) {
    return `${theme.badge('docs')} ${theme.dim('No generated artifacts.')}`;
  }

  const lines = artifacts.map((artifact) => `${theme.hl(artifact.type)} ${artifact.path}`);
  return `${theme.badge('docs')}\n${lines.join('\n')}`;
}

function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
