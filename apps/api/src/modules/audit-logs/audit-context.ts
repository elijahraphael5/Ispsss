import { AsyncLocalStorage } from 'async_hooks';

export class AuditContext {
  private static storage = new AsyncLocalStorage<string>();

  static run<R>(actorId: string, fn: () => R): R {
    return this.storage.run(actorId, fn);
  }

  static getActorId(): string | undefined {
    return this.storage.getStore();
  }
}
