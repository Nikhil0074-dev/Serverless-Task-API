'use strict';

/**
 * Storage layer. Two implementations with the same interface:
 *   - MemoryStore:   tests and the zero-dependency dev server (STORE=memory)
 *   - FileStore:     serverless-offline (STORE=file). Offline runs every function
 *                    in its own worker, so memory is NOT shared between functions;
 *                    a JSON file is.
 *   - DynamoStore:   deployed to AWS (STORE=dynamodb)
 *   - RedisStore:    deployed to Vercel (STORE=redis, see redis-store.js)
 *
 * The DynamoDB client is created once per container (outside the handler),
 * so warm invocations reuse the connection. The SDK is loaded lazily so
 * local mode never needs it.
 */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function newTask(input) {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now };
}

function sortNewestFirst(items) {
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

class MemoryStore {
  constructor() {
    this.tasks = new Map();
  }

  async create(input) {
    const task = newTask(input);
    this.tasks.set(task.id, task);
    return { ...task };
  }

  async get(id) {
    const t = this.tasks.get(id);
    return t ? { ...t } : null;
  }

  async list({ status, limit = 50 } = {}) {
    let items = [...this.tasks.values()];
    if (status) items = items.filter((t) => t.status === status);
    return sortNewestFirst(items).slice(0, limit).map((t) => ({ ...t }));
  }

  async update(id, patch) {
    const existing = this.tasks.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.tasks.set(id, updated);
    return { ...updated };
  }
}

/** JSON-file store for local use. Not for production: single machine, no locking across processes. */
class FileStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve(); // serialises operations inside one process
  }

  _run(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  async _read() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return {};
      if (err instanceof SyntaxError) return {};
      throw err;
    }
  }

  async _write(data) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, this.filePath); // atomic replace
  }

  create(input) {
    return this._run(async () => {
      const data = await this._read();
      const task = newTask(input);
      data[task.id] = task;
      await this._write(data);
      return task;
    });
  }

  get(id) {
    return this._run(async () => (await this._read())[id] || null);
  }

  list({ status, limit = 50 } = {}) {
    return this._run(async () => {
      let items = Object.values(await this._read());
      if (status) items = items.filter((t) => t.status === status);
      return sortNewestFirst(items).slice(0, limit);
    });
  }

  update(id, patch) {
    return this._run(async () => {
      const data = await this._read();
      if (!data[id]) return null;
      data[id] = { ...data[id], ...patch, updatedAt: new Date().toISOString() };
      await this._write(data);
      return data[id];
    });
  }
}

class DynamoStore {
  /**
   * @param {string} tableName
   * @param {object} [deps] optional injection for tests: { client, commands }
   */
  constructor(tableName, deps = {}) {
    this.tableName = tableName;
    if (deps.client) {
      this.client = deps.client;
      this.cmd = deps.commands;
    } else {
      const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
      const lib = require('@aws-sdk/lib-dynamodb');
      this.client = lib.DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      });
      this.cmd = {
        Put: lib.PutCommand,
        Get: lib.GetCommand,
        Scan: lib.ScanCommand,
        Update: lib.UpdateCommand,
      };
    }
  }

  async create(input) {
    const task = newTask(input);
    await this.client.send(
      new this.cmd.Put({
        TableName: this.tableName,
        Item: task,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );
    return task;
  }

  async get(id) {
    const res = await this.client.send(new this.cmd.Get({ TableName: this.tableName, Key: { id } }));
    return res.Item || null;
  }

  async list({ status, limit = 50 } = {}) {
    // Scan is fine for a small demo table. For large tables use a GSI + Query.
    const items = [];
    let startKey;
    do {
      const params = { TableName: this.tableName, ExclusiveStartKey: startKey };
      if (status) {
        params.FilterExpression = '#s = :s';
        params.ExpressionAttributeNames = { '#s': 'status' };
        params.ExpressionAttributeValues = { ':s': status };
      }
      const res = await this.client.send(new this.cmd.Scan(params));
      items.push(...(res.Items || []));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return sortNewestFirst(items).slice(0, limit);
  }

  async update(id, patch) {
    const names = { '#updatedAt': 'updatedAt' };
    const values = { ':updatedAt': new Date().toISOString() };
    const sets = ['#updatedAt = :updatedAt'];
    Object.keys(patch).forEach((key, i) => {
      names[`#f${i}`] = key;
      values[`:v${i}`] = patch[key];
      sets.push(`#f${i} = :v${i}`);
    });

    try {
      const res = await this.client.send(
        new this.cmd.Update({
          TableName: this.tableName,
          Key: { id },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: 'attribute_exists(id)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        })
      );
      return res.Attributes;
    } catch (err) {
      if (err && err.name === 'ConditionalCheckFailedException') return null;
      throw err;
    }
  }
}

let instance = null;

function getStore() {
  if (!instance) {
    // On Vercel, memory/file storage would silently lose data, so default to Redis there.
    const kind = process.env.STORE || (process.env.VERCEL ? 'redis' : 'memory');
    if (kind === 'redis') instance = new (require('./redis-store').RedisStore)();
    else if (kind === 'dynamodb') instance = new DynamoStore(process.env.TASKS_TABLE);
    else if (kind === 'file') instance = new FileStore(process.env.TASKS_FILE || path.join(process.cwd(), '.data', 'tasks.json'));
    else instance = new MemoryStore();
  }
  return instance;
}

function setStore(store) {
  instance = store;
}

module.exports = { MemoryStore, FileStore, DynamoStore, getStore, setStore };
