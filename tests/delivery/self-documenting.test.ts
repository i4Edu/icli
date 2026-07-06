import { describe, expect, it } from 'vitest';
import {
  SelfDocumenter,
  formatADR,
  formatDocumentList,
} from '../../src/delivery/self-documenting.js';

describe('SelfDocumenter', () => {
  it('generates ADRs and formats them', () => {
    const documenter = new SelfDocumenter({ outputDir: 'docs/generated' });
    const adr = documenter.generateADR({
      title: 'Adopt delivery pipeline orchestration',
      context: 'Phase 29 requires autonomous delivery controls.',
      decision: 'Introduce delivery subsystem modules.',
      consequences: 'Higher automation with clearer release state.',
      status: 'accepted',
    });

    expect(adr.status).toBe('accepted');
    expect(formatADR(adr)).toContain('Adopt delivery pipeline orchestration');
    expect(documenter.listArtifacts()[0]?.path).toContain('docs/generated');
  });

  it('tracks generated documentation artifacts', () => {
    const documenter = new SelfDocumenter();
    documenter.generateAPIDocs(['src/delivery/pipeline.ts', 'src/delivery/execution-fabric.ts']);
    documenter.generateChangelog('v2.3.0', 'v2.4.0');
    documenter.generateReleaseNotes('v2.4.0');

    const artifacts = documenter.listArtifacts();
    expect(artifacts).toHaveLength(3);
    expect(formatDocumentList(artifacts)).toContain('api-doc');
    expect(documenter.getConfig().formats).toEqual(['md']);
  });
});
