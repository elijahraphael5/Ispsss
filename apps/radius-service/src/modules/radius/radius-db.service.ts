import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as mysql from 'mysql2/promise';

type Rows<T> = T extends Array<infer U> ? U : never;

@Injectable()
export class RadiusDbService implements OnModuleDestroy {
  private readonly logger = new Logger(RadiusDbService.name);
  private readonly pool: mysql.Pool;

  constructor() {
    const config: mysql.PoolOptions = {
      host: process.env.RADIUS_DB_HOST ?? 'localhost',
      port: parseInt(process.env.RADIUS_DB_PORT ?? '3306', 10),
      user: process.env.RADIUS_DB_USER ?? 'radius',
      password: process.env.RADIUS_DB_PASSWORD ?? 'radiuspw',
      database: process.env.RADIUS_DB_NAME ?? 'radius',
      connectionLimit: parseInt(process.env.RADIUS_DB_POOL_SIZE ?? '10', 10),
    };
    this.pool = mysql.createPool(config);
  }

  async query<T = Record<string, unknown>[]>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T> {
    const [rows] = await this.pool.query<any[]>(sql, params);
    return rows as T;
  }

  async execute(sql: string, params: unknown[] = []): Promise<mysql.ResultSetHeader> {
    const [result] = await this.pool.execute<mysql.ResultSetHeader>(sql, params as any);
    return result;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

export type RadiusRow = Rows<mysql.RowDataPacket>;