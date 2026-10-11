/** Serializes decisions for the same account before reserving DB connections. */
export class AccountExecutionQueue {
  private pending = new Map<string, Promise<void>>();

  run<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(accountId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => {},
      () => {},
    );
    this.pending.set(accountId, tail);
    void tail.then(() => {
      if (this.pending.get(accountId) === tail) this.pending.delete(accountId);
    });
    return result;
  }
}
