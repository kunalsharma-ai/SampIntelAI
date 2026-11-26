import { z } from 'zod';

/** The eleven roles of spec §13, shared with Supply360 for SSO. One matrix drives the API guards and the UI. */
export const Role = z.enum([
  'super_admin',
  'tenant_admin',
  'supply_head',
  'supply_manager',
  'supply_executive',
  'project_manager',
  'quality_analyst',
  'ai_operations_manager',
  'integration_admin',
  'reporting_user',
  'read_only',
]);
export type Role = z.infer<typeof Role>;

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  tenant_admin: 'Tenant Admin',
  supply_head: 'Supply Head',
  supply_manager: 'Supply Manager',
  supply_executive: 'Supply Executive',
  project_manager: 'Project Manager',
  quality_analyst: 'Quality Analyst',
  ai_operations_manager: 'AI Operations Manager',
  integration_admin: 'Integration Admin',
  reporting_user: 'Reporting User',
  read_only: 'Read-only',
};

export const Permission = z.enum([
  // platform
  'tenants.manage',
  'users.read',
  'users.manage',
  'roles.read',
  'audit.read',
  'settings.read',
  'settings.manage',
  'security.read',
  'notifications.read',
  // integrations
  'integrations.read',
  'integrations.manage',
  // QA projects and authorization (spec §9)
  'qa_projects.read',
  'qa_projects.manage',
  'authorizations.read',
  'authorizations.request',
  'authorizations.manage',
  'authorizations.revoke',
  'scenarios.manage',
  'executions.run',
  'executions.emergency_stop',
  // results
  'results.read',
  'results.review',
  'ip_risk.read',
  // AI providers and budgets
  'providers.manage',
  'budgets.manage',
  // reporting
  'reports.read',
  'reports.export',
]);
export type Permission = z.infer<typeof Permission>;

const ALL = Permission.options;
const READ: Permission[] = ['qa_projects.read', 'results.read', 'reports.read', 'notifications.read', 'settings.read'];

/**
 * Separation of duties: the people who run synthetic QA (AI Operations Manager) cannot approve the survey-owner
 * authorization that allows it; a Supply Head or admin records and approves authorizations.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: ALL,
  tenant_admin: ALL.filter((p) => p !== 'tenants.manage'),
  supply_head: [
    ...READ,
    'authorizations.read',
  'authorizations.request',
    'authorizations.manage',
    'authorizations.revoke',
    'executions.emergency_stop',
    'reports.export',
    'users.read',
    'audit.read',
  ],
  supply_manager: [...READ, 'authorizations.read', 'executions.emergency_stop'],
  supply_executive: READ,
  project_manager: [...READ, 'qa_projects.manage', 'authorizations.read', 'authorizations.request', 'reports.export'],
  quality_analyst: [...READ, 'results.review', 'ip_risk.read', 'reports.export'],
  ai_operations_manager: [
    ...READ,
    'qa_projects.manage',
    'authorizations.read',
  'authorizations.request',
    'authorizations.revoke',
    'scenarios.manage',
    'executions.run',
    'executions.emergency_stop',
    'results.review',
    'ip_risk.read',
    'providers.manage',
    'budgets.manage',
    'reports.export',
    'integrations.read',
    'audit.read',
    'security.read',
  ],
  integration_admin: [...READ, 'integrations.read', 'integrations.manage', 'audit.read', 'security.read'],
  reporting_user: [...READ, 'reports.export'],
  read_only: READ,
};

export function permissionsFor(roles: readonly Role[]): Permission[] {
  const set = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r]) set.add(p);
  return [...set].sort();
}

/** Roles a person may grant: never one with permissions they lack themselves. */
export function canGrant(granter: readonly Permission[], role: Role): boolean {
  const own = new Set(granter);
  return ROLE_PERMISSIONS[role].every((p) => own.has(p));
}
