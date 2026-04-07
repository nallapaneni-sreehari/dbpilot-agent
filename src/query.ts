import { Client as PgClient } from 'pg';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';

export interface ConnectionParams {
  connectionUrl?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  databaseName?: string;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: string[];
  sql: string;
}

export async function runQuery(
  dbType: string,
  params: ConnectionParams,
  sql: string,
): Promise<QueryResult> {
  switch (dbType.toUpperCase()) {
    case 'POSTGRESQL':
      return runPostgres(params, sql);
    case 'MYSQL':
      return runMysql(params, sql);
    case 'MONGODB':
      return runMongo(params, sql);
    default:
      throw new Error(`Unsupported DB type: ${dbType}`);
  }
}

async function runPostgres(params: ConnectionParams, sql: string): Promise<QueryResult> {
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
    const result = await client.query(sql);
    const rows = result.rows as Record<string, unknown>[];
    return {
      rows,
      rowCount: rows.length,
      fields: result.fields.map((f) => f.name),
      sql,
    };
  } finally {
    await client.end();
  }
}

async function runMysql(params: ConnectionParams, sql: string): Promise<QueryResult> {
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

  try {
    const [rows, fields] = await conn.query<mysql.RowDataPacket[]>(sql);
    return {
      rows: rows as Record<string, unknown>[],
      rowCount: rows.length,
      fields: (fields as mysql.FieldPacket[]).map((f) => f.name),
      sql,
    };
  } finally {
    await conn.end();
  }
}

async function runMongo(params: ConnectionParams, sql: string): Promise<QueryResult> {
  const uri =
    params.connectionUrl ??
    `mongodb://${encodeURIComponent(params.username!)}:${encodeURIComponent(params.password!)}@${params.host}:${params.port}/${params.databaseName}`;

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    const dbName =
      params.databaseName ?? new URL(uri).pathname.slice(1).split('?')[0];
    const db = client.db(dbName || undefined);

    let parsed: { collection: string; pipeline: Record<string, unknown>[] };
    try {
      parsed = JSON.parse(sql) as typeof parsed;
    } catch {
      throw new Error('MongoDB queries must be JSON: {"collection":"name","pipeline":[...]}');
    }

    const rows = await db
      .collection(parsed.collection)
      .aggregate(parsed.pipeline)
      .toArray();

    const fields = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { rows: rows as Record<string, unknown>[], rowCount: rows.length, fields, sql };
  } finally {
    await client.close();
  }
}
