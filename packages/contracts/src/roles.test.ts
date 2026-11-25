import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, Role, canGrant, permissionsFor } from './roles.js';

describe('role matrix', () => {
  it('defines every role', () => {
    for (const r of Role.options) expect(ROLE_PERMISSIONS[r].length).toBeGreaterThan(0);
  });
  it('only super admins manage tenants', () => {
    const holders = Role.options.filter((r) => ROLE_PERMISSIONS[r].includes('tenants.manage'));
    expect(holders).toEqual(['super_admin']);
  });
  it('read-only cannot change anything', () => {
    expect(permissionsFor(['read_only']).every((p) => p.endsWith('.read'))).toBe(true);
  });
  it('whoever runs synthetic QA cannot also approve its authorization', () => {
    const p = permissionsFor(['ai_operations_manager']);
    expect(p).toContain('executions.run');
    expect(p).not.toContain('authorizations.manage');
  });
  it('anyone who can run or approve QA can also stop it', () => {
    for (const r of Role.options) {
      const p = ROLE_PERMISSIONS[r];
      if (p.includes('executions.run') || p.includes('authorizations.manage'))
        expect(p).toContain('executions.emergency_stop');
    }
  });
  it('nobody can grant a role with more power than they hold', () => {
    expect(canGrant(permissionsFor(['tenant_admin']), 'super_admin')).toBe(false);
    expect(canGrant(permissionsFor(['tenant_admin']), 'supply_head')).toBe(true);
    expect(canGrant(permissionsFor(['supply_manager']), 'supply_head')).toBe(false);
  });
});
