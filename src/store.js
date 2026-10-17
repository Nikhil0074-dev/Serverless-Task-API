'use strict';
// Storage abstraction. In-memory by default (tests, local demo, free tier friendly);
// switches to DynamoDB automatically when TABLE_NAME is set (deployed on AWS).
// Clients are created lazily and cached OUTSIDE the handler so warm invocations reuse them
// (this is what keeps cold starts short).

const { randomUUID } = require('node:crypto');

class MemoryStore {
  constructor() { this.items = new Map(); }
  async create(data) {
    const now = new Date().toISOString();
    const task = { id: randomUUID(), description: '', status: 'todo', priority: 'medium', dueDate: null, ...data, createdAt: now, updatedAt: now };
    this.items.set(task.id, task);
    return task;
  }
  async get(id) { return this.items.get(id) || null; }
  async list({ status } = {}) {
    const all = [...this.items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return status ? all.filter((t) => t.status === status) : all;
  }
  async update(id, patch) {
    const current = this.items.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.items.set(id, next);
    return next;
  }
  async remove(id) { return this.items.delete(id); }
  clear() { this.items.clear(); }
}

class DynamoStore {
  constructor(tableName) {
    this.table = tableName;
    this._doc = null;
  }
  _client() {
    if (!this._doc) {
      const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
      this._doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
    }
    return this._doc;
  }
  async create(data) {
    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    const now = new Date().toISOString();
    const task = { id: randomUUID(), description: '', status: 'todo', priority: 'medium', dueDate: null, ...data, createdAt: now, updatedAt: now };
    await this._client().send(new PutCommand({ TableName: this.table, Item: task, ConditionExpression: 'attribute_not_exists(id)' }));
    return task;
  }
  async get(id) {
    const { GetCommand } = require('@aws-sdk/lib-dynamodb');
    const res = await this._client().send(new GetCommand({ TableName: this.table, Key: { id } }));
    return res.Item || null;
  }
  async list({ status } = {}) {
    const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
    const items = [];
    let ExclusiveStartKey;
    do {
      const res = await this._client().send(new ScanCommand({ TableName: this.table, ExclusiveStartKey }));
      items.push(...(res.Items || []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return status ? items.filter((t) => t.status === status) : items;
  }
  async update(id, patch) {
    const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    const fields = { ...patch, updatedAt: new Date().toISOString() };
    const names = {}; const values = {}; const sets = [];
    Object.keys(fields).forEach((k, i) => { names[`#k${i}`] = k; values[`:v${i}`] = fields[k]; sets.push(`#k${i} = :v${i}`); });
    try {
      const res = await this._client().send(new UpdateCommand({
        TableName: this.table, Key: { id },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: 'ALL_NEW',
      }));
      return res.Attributes;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return null;
      throw err;
    }
  }
  async remove(id) {
    const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
    try {
      await this._client().send(new DeleteCommand({ TableName: this.table, Key: { id }, ConditionExpression: 'attribute_exists(id)' }));
      return true;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  }
}

let singleton;
function getStore() {
  if (!singleton) singleton = process.env.TABLE_NAME ? new DynamoStore(process.env.TABLE_NAME) : new MemoryStore();
  return singleton;
}
function setStore(store) { singleton = store; }

module.exports = { MemoryStore, DynamoStore, getStore, setStore };
