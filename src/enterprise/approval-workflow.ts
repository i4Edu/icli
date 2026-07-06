import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface ApprovalGate {
  id: string;
  name: string;
  trigger: string;
  requiredApprovers: number;
  timeout: number;
  escalation?: string;
}

export interface Approval {
  userId: string;
  decision: 'approve' | 'deny';
  timestamp: string;
  comment?: string;
}

export interface ApprovalRequest {
  id: string;
  gateId: string;
  action: string;
  context: Record<string, unknown>;
  requestedBy: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  approvals: Approval[];
}

export interface ApprovalWorkflowOptions {
  gates?: ApprovalGate[];
  now?: () => Date;
}

const APPROVAL_GATES_FILE = path.join('.icopilot', 'enterprise', 'approval-gates.yaml');

export class ApprovalWorkflow {
  private readonly gates = new Map<string, ApprovalGate>();
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly now: () => Date;

  constructor(options: ApprovalWorkflowOptions = {}) {
    this.now = options.now ?? (() => new Date());
    for (const gate of options.gates ?? []) {
      this.addGate(gate);
    }
  }

  addGate(gate: ApprovalGate): ApprovalGate {
    const normalized = normalizeGate(gate);
    this.gates.set(normalized.id, normalized);
    return cloneGate(normalized);
  }

  removeGate(id: string): boolean {
    return this.gates.delete(id.trim());
  }

  requestApproval(action: string, context: Record<string, unknown> = {}): ApprovalRequest {
    this.expireRequests();
    const normalizedAction = requireValue(action, 'action');
    const gate = this.checkGate(normalizedAction);
    const timestamp = this.now().toISOString();
    const requestedBy =
      typeof context.requestedBy === 'string' && context.requestedBy.trim().length > 0
        ? context.requestedBy.trim()
        : 'system';

    const request: ApprovalRequest = {
      id: createId('approval-request', this.requests.size + 1),
      gateId: gate?.id ?? 'auto-approve',
      action: normalizedAction,
      context: cloneContext(context),
      requestedBy,
      requestedAt: timestamp,
      status: gate ? 'pending' : 'approved',
      approvals: gate
        ? []
        : [
            {
              userId: 'system',
              decision: 'approve',
              timestamp,
              comment: 'No approval gate matched.',
            },
          ],
    };

    this.requests.set(request.id, request);
    return cloneRequest(request);
  }

  approve(requestId: string, approval: Approval): ApprovalRequest {
    this.expireRequests();
    const request = this.requireRequest(requestId);
    if (request.status !== 'pending') return cloneRequest(request);
    const gate = this.gates.get(request.gateId);
    const normalized = normalizeApproval(approval, 'approve');
    upsertApproval(request, normalized);

    const approvedCount = request.approvals.filter((entry) => entry.decision === 'approve').length;
    if (!gate || approvedCount >= gate.requiredApprovers) {
      request.status = 'approved';
    }
    return cloneRequest(request);
  }

  deny(requestId: string, approval: Approval): ApprovalRequest {
    this.expireRequests();
    const request = this.requireRequest(requestId);
    if (request.status !== 'pending') return cloneRequest(request);
    upsertApproval(request, normalizeApproval(approval, 'deny'));
    request.status = 'denied';
    return cloneRequest(request);
  }

  getPending(): ApprovalRequest[] {
    this.expireRequests();
    return this.history('pending');
  }

  checkGate(action: string): ApprovalGate | null {
    const normalizedAction = requireValue(action, 'action');
    const gates = [...this.gates.values()].sort((left, right) => right.trigger.length - left.trigger.length);
    for (const gate of gates) {
      if (matchesTrigger(gate.trigger, normalizedAction)) {
        return cloneGate(gate);
      }
    }
    return null;
  }

  getHistory(limit?: number): ApprovalRequest[] {
    this.expireRequests();
    const requests = this.history();
    return typeof limit === 'number' && limit >= 0 ? requests.slice(0, limit) : requests;
  }

  private history(status?: ApprovalRequest['status']): ApprovalRequest[] {
    return [...this.requests.values()]
      .filter((request) => (status ? request.status === status : true))
      .sort(
        (left, right) =>
          right.requestedAt.localeCompare(left.requestedAt) || right.id.localeCompare(left.id),
      )
      .map(cloneRequest);
  }

  private requireRequest(requestId: string): ApprovalRequest {
    const request = this.requests.get(requestId.trim());
    if (!request) {
      throw new Error(`approval request not found: ${requestId}`);
    }
    return request;
  }

  private expireRequests(): void {
    const now = this.now().getTime();
    for (const request of this.requests.values()) {
      if (request.status !== 'pending') continue;
      const gate = this.gates.get(request.gateId);
      if (!gate) continue;
      const requestedAt = Date.parse(request.requestedAt);
      if (!Number.isFinite(requestedAt)) continue;
      if (now - requestedAt >= gate.timeout * 1000) {
        request.status = 'expired';
      }
    }
  }
}

export function loadApprovalGates(cwd = config.cwd): ApprovalGate[] {
  const file = path.join(path.resolve(cwd), APPROVAL_GATES_FILE);
  if (!fs.existsSync(file)) return [];

  try {
    const parsed = parse(fs.readFileSync(file, 'utf8')) as unknown;
    const rawGates =
      Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).gates)
          ? ((parsed as Record<string, unknown>).gates as unknown[])
          : [];
    return rawGates.map(normalizeGate);
  } catch {
    return [];
  }
}

export function formatApprovalRequest(request: ApprovalRequest): string {
  const statusTheme =
    request.status === 'approved'
      ? theme.ok
      : request.status === 'denied'
        ? theme.err
        : request.status === 'expired'
          ? theme.warn
          : theme.hl;
  const lines = [
    `${theme.brand('Approval request')} ${theme.dim(`(${request.id})`)}`,
    `  action: ${request.action}`,
    `  gate: ${request.gateId}`,
    `  requested by: ${request.requestedBy} at ${request.requestedAt}`,
    `  status: ${statusTheme(request.status)}`,
    `  approvals: ${request.approvals.length}`,
  ];

  for (const approval of request.approvals) {
    lines.push(
      `    - ${approval.userId}: ${approval.decision} @ ${approval.timestamp}${approval.comment ? ` ${theme.dim(`(${approval.comment})`)}` : ''}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

function normalizeGate(value: ApprovalGate): ApprovalGate {
  return {
    id: requireValue(value.id, 'gate id'),
    name: requireValue(value.name, 'gate name'),
    trigger: requireValue(value.trigger, 'gate trigger'),
    requiredApprovers: normalizePositiveInteger(value.requiredApprovers, 'required approvers'),
    timeout: normalizePositiveInteger(value.timeout, 'timeout'),
    escalation: typeof value.escalation === 'string' && value.escalation.trim().length > 0 ? value.escalation.trim() : undefined,
  };
}

function normalizeApproval(
  value: Approval,
  expectedDecision: Approval['decision'],
): Approval {
  if (value.decision !== expectedDecision) {
    throw new Error(`approval decision must be ${expectedDecision}`);
  }
  return {
    userId: requireValue(value.userId, 'approval user id'),
    decision: value.decision,
    timestamp: normalizeTimestamp(value.timestamp),
    comment: typeof value.comment === 'string' && value.comment.trim().length > 0 ? value.comment.trim() : undefined,
  };
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${label} must be at least 1`);
  }
  return Math.floor(value);
}

function normalizeTimestamp(value?: string): string {
  if (!value) return new Date().toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function requireValue(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function matchesTrigger(trigger: string, action: string): boolean {
  if (trigger === '*') return true;
  const escaped = trigger.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(action);
}

function createId(prefix: string, index: number): string {
  return `${prefix}-${index}-${Date.now().toString(36)}`;
}

function upsertApproval(request: ApprovalRequest, approval: Approval): void {
  const index = request.approvals.findIndex((entry) => entry.userId === approval.userId);
  if (index >= 0) {
    request.approvals[index] = approval;
    return;
  }
  request.approvals.push(approval);
}

function cloneGate(gate: ApprovalGate): ApprovalGate {
  return { ...gate };
}

function cloneRequest(request: ApprovalRequest): ApprovalRequest {
  return {
    ...request,
    context: cloneContext(request.context),
    approvals: request.approvals.map((approval) => ({ ...approval })),
  };
}

function cloneContext(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(context));
}
