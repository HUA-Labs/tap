declare module "bun:sqlite" {
  export class Database {
    constructor(
      path: string,
      options?: {
        create?: boolean;
      },
    );
    exec(sql: string): void;
    run(sql: string, params?: unknown[]): unknown;
    prepare(sql: string): {
      all(...params: unknown[]): unknown;
      get(...params: unknown[]): unknown;
    };
    close(): void;
  }
}
