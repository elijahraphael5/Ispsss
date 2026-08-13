import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';

describe('Owner Access Control', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();

    guard = module.get(RolesGuard);
    reflector = module.get(Reflector);
  });

  function mockContext(handlerRoles: string[], user: Record<string, unknown> | null) {
    const handler = { constructor: { name: 'OwnerController' } };
    reflector.get = jest.fn().mockReturnValue(handlerRoles);
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: user ?? undefined }),
      }),
      getHandler: () => handler,
      getClass: () => ({ name: 'OwnerController' }),
    } as any;
  }

  it('should allow SUPERADMIN user to access owner routes', () => {
    const ctx = mockContext(['SUPERADMIN'], { id: '1', isSuperAdmin: true });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should block TENANT_ADMIN user from owner routes', () => {
    const ctx = mockContext(['SUPERADMIN'], {
      id: '2',
      isSuperAdmin: false,
      customRole: { name: 'TENANT_ADMIN' },
    });
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('should block user with no role from owner routes', () => {
    const ctx = mockContext(['SUPERADMIN'], {
      id: '3',
      isSuperAdmin: false,
    });
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('should block null user from owner routes', () => {
    const ctx = mockContext(['SUPERADMIN'], null);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('should allow user with matching role name on regular routes', () => {
    const ctx = mockContext(['OPERATIONS_MANAGER', 'CEO'], {
      id: '4',
      isSuperAdmin: false,
      customRole: { name: 'OPERATIONS_MANAGER' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should block TENANT_ADMIN from routes requiring OPERATIONS_MANAGER', () => {
    const ctx = mockContext(['OPERATIONS_MANAGER'], {
      id: '5',
      isSuperAdmin: false,
      customRole: { name: 'TENANT_ADMIN' },
    });
    expect(guard.canActivate(ctx)).toBe(false);
  });
});
