import { AsyncLocalStorage } from 'async_hooks';

export class TenantContext {
  private static storage = new AsyncLocalStorage<string>();

  static run<R>(tenantId: string, fn: () => R): R {
    return this.storage.run(tenantId, fn);
  }

  static getTenantId(): string | undefined {
    return this.storage.getStore();
  }
}
