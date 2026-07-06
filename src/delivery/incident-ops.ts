import { randomUUID } from 'node:crypto';
import { theme } from '../ui/theme.js';

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'detected' | 'triaging' | 'mitigating' | 'resolved';

export interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  detectedAt: string;
  resolvedAt?: string;
  assignee?: string;
  remediation?: string;
}

export interface IncidentDetection {
  source: string;
  signal: string;
  confidence: number;
  suggestedSeverity: IncidentSeverity;
}

export interface Remediation {
  incidentId: string;
  steps: string[];
  automated: boolean;
  applied: boolean;
  rollbackAvailable: boolean;
}

export class IncidentManager {
  private readonly incidents = new Map<string, Incident>();
  private readonly remediations = new Map<string, Remediation>();
  private readonly history: string[] = [];

  detect(signal: string): IncidentDetection {
    return {
      source: 'telemetry',
      signal,
      confidence: inferConfidence(signal),
      suggestedSeverity: inferSeverity(signal),
    };
  }

  create(
    incident: Omit<Incident, 'id' | 'detectedAt' | 'status'> &
      Partial<Pick<Incident, 'id' | 'detectedAt' | 'status'>>,
  ): Incident {
    const normalized: Incident = {
      id: incident.id ?? randomUUID(),
      title: incident.title,
      severity: incident.severity,
      status: incident.status ?? 'detected',
      detectedAt: incident.detectedAt ?? new Date().toISOString(),
      resolvedAt: incident.resolvedAt,
      assignee: incident.assignee,
      remediation: incident.remediation,
    };
    this.incidents.set(normalized.id, structuredClone(normalized));
    this.history.push(normalized.id);
    return structuredClone(normalized);
  }

  triage(id: string): Incident | undefined {
    return this.updateIncident(id, (incident) => {
      incident.status = 'triaging';
    });
  }

  suggestRemediation(id: string): Remediation | undefined {
    const incident = this.incidents.get(id);
    if (!incident) return undefined;

    const remediation: Remediation = {
      incidentId: id,
      steps: remediationSteps(incident.severity),
      automated: incident.severity !== 'critical',
      applied: false,
      rollbackAvailable: incident.severity === 'critical' || incident.severity === 'high',
    };
    this.remediations.set(id, structuredClone(remediation));
    return structuredClone(remediation);
  }

  applyRemediation(id: string, remediation: Remediation): Incident | undefined {
    this.remediations.set(id, { ...structuredClone(remediation), applied: true });
    return this.updateIncident(id, (incident) => {
      incident.status = 'mitigating';
      incident.remediation = remediation.steps.join(' ');
    });
  }

  resolve(id: string): Incident | undefined {
    return this.updateIncident(id, (incident) => {
      incident.status = 'resolved';
      incident.resolvedAt = new Date().toISOString();
    });
  }

  getActive(): Incident[] {
    return [...this.incidents.values()]
      .filter((incident) => incident.status !== 'resolved')
      .map((incident) => structuredClone(incident));
  }

  getHistory(limit?: number): Incident[] {
    const items = this.history
      .map((id) => this.incidents.get(id))
      .filter(isDefined)
      .reverse();
    return (limit ? items.slice(0, limit) : items).map((incident) => structuredClone(incident));
  }

  private updateIncident(id: string, apply: (incident: Incident) => void): Incident | undefined {
    const incident = this.incidents.get(id);
    if (!incident) return undefined;
    apply(incident);
    this.incidents.set(id, structuredClone(incident));
    return structuredClone(incident);
  }
}

export function formatIncident(incident: Incident): string {
  return `${theme.badge('incident')} ${colorSeverity(incident.severity)} ${theme.hl(incident.title)} ${colorIncidentStatus(incident.status)}`;
}

export function formatIncidentList(incidents: Incident[]): string {
  if (!incidents.length) {
    return `${theme.badge('incident')} ${theme.dim('No incidents recorded.')}`;
  }
  return incidents.map((incident) => formatIncident(incident)).join('\n');
}

function inferSeverity(signal: string): IncidentSeverity {
  const normalized = signal.toLowerCase();
  if (normalized.includes('critical') || normalized.includes('outage')) return 'critical';
  if (normalized.includes('high') || normalized.includes('latency')) return 'high';
  if (normalized.includes('medium') || normalized.includes('degraded')) return 'medium';
  return 'low';
}

function inferConfidence(signal: string): number {
  const severity = inferSeverity(signal);
  switch (severity) {
    case 'critical':
      return 0.95;
    case 'high':
      return 0.85;
    case 'medium':
      return 0.7;
    case 'low':
      return 0.55;
  }
}

function remediationSteps(severity: IncidentSeverity): string[] {
  switch (severity) {
    case 'critical':
      return ['Disable the impacted release.', 'Roll back to the last known good state.'];
    case 'high':
      return ['Scale the affected service.', 'Restart the unhealthy workloads.'];
    case 'medium':
      return ['Capture additional diagnostics.', 'Apply the queued mitigation patch.'];
    case 'low':
      return ['Log the issue for follow-up.', 'Monitor the next verification cycle.'];
  }
}

function colorSeverity(severity: IncidentSeverity): string {
  switch (severity) {
    case 'critical':
      return theme.err(severity);
    case 'high':
      return theme.warn(severity);
    case 'medium':
      return theme.brand(severity);
    case 'low':
      return theme.dim(severity);
  }
}

function colorIncidentStatus(status: IncidentStatus): string {
  switch (status) {
    case 'resolved':
      return theme.ok(status);
    case 'triaging':
      return theme.warn(status);
    case 'mitigating':
      return theme.brand(status);
    case 'detected':
      return theme.dim(status);
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
