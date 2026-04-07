import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import { ConnectionParams } from './query';

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
}

export interface TableSchema {
  tableName: string;
  columns: ColumnSchema[];
}

export async function extractSchema(
  dbType: string,
  params: ConnectionParams,
): Promise<TableSchema[]> {
  switch (dbType.toUpperCase()) {
    case 'POSTGRESQL':
      return extractPostgresSchema(params);
    case 'MYSQL':
      return extractMysqlSchema(params);
    case 'MONGODB':
      return extractMongoSchema(params);
    default:
      throw new Error(`Unsupported DB type: ${dbType}`);
  }
}

async function extractPostgresSchema(params: ConnectionParams): Promise<TableSchema[]> {
  const client = params.connectionUrl
    ? new PgClient({ connectionString: params.connectionUrl, connectionTimeoutMillis: 10000 })
    : new PgClient({
        host: params.host,
        port: params.port,
        user: params.username,
        password: params.password,
        database: params.databaseName,
        connectionTimeoutMillis: 10000,
      });
  await client.connect();
  try {
    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const tables: TableSchema[] = [];
    for (const row of tablesRes.rows) {
      const colsRes = await client.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [row.table_name],
      );
      tables.push({
        tableName: row.table_name,
        columns: colsRes.rows.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === 'YES',
        })),
      });
    }
    return tables;
  } finally {
    await client.end();
  }
}

async function extractMysqlSchema(params: ConnectionParams): Promise<TableSchema[]> {
  const conn = params.connectionUrl
    ? await mysql.createConnection({ uri: params.connectionUrl, connectTimeout: 10000 })
    : await mysql.createConnection({
        host: params.host,
        port: params.port,
        user: params.username,
        password: params.password,
        database: params.databaseName,
        connectTimeout: 10000,
      });
  const dbName =
    params.databaseName ??
    (params.connectionUrl ? new URL(params.connectionUrl).pathname.slice(1) : '');
  try {
    const [tableRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [dbName],
    );
    const tables: TableSchema[] = [];
    for (const row of tableRows) {
      const [colRows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [dbName, row['TABLE_NAME'] as string],
      );
      tables.push({
        tableName: row['TABLE_NAME'] as string,
        columns: colRows.map((c) => ({
          name: c['COLUMN_NAME'] as string,
          type: c['DATA_TYPE'] as string,
          nullable: c['IS_NULLABLE'] === 'YES',
        })),
      });
    }
    return tables;
  } finally {
    await conn.end();
  }
}

async function extractMongoSchema(params: ConnectionParams): Promise<TableSchema[]> {
  const uri =
    params.connectionUrl ??
    `mongodb://${encodeURIComponent(params.username!)}:${encodeURIComponent(params.password!)}@${params.host}:${params.port}/${params.databaseName}`;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    const dbName =
      params.databaseName ?? new URL(uri).pathname.slice(1).split('?')[0];
    const db = client.db(dbName || undefined);
    const collections = await db.listCollections().toArray();
    const tables: TableSchema[] = [];
    for (const col of collections) {
      const sample = await db.collection(col.name).findOne();
      const columns: ColumnSchema[] = sample
        ? Object.entries(sample).map(([key, val]) => ({
            name: key,
            type: typeof val,
            nullable: true,
          }))
        : [];
      tables.push({ tableName: col.name, columns });
    }
    return tables;
  } finally {
    await client.close();
  }
}
