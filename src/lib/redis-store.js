'use strict';

/**
 * Redis store using the Upstash REST API (plain HTTPS, no SDK needed).
 * Works with the Upstash Redis integration from the Vercel Marketplace.
 * All tasks live in one Redis hash: field = task id, value = task JSON.
 *
 * Env vars (either naming works):
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL        / KV_REST_API_TOKEN
 */

const crypto = require('node:crypto');

class RedisStore {
  constructor({ url, token, fetchImpl, key = 'tasks' } = {}) {
    this.url = url || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    this.token = token || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    this.fetch = fetchImpl || globalThis.fetch;
    this.key = key;
    if (!this.url || !this.token) {
      throw new Error(
        'Redis is not configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN)'
      );
    }
  }

  async _cmd(args) {
    const res = await this.fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Redis returned a non-JSON response (HTTP ${res.status})`);
    }
    if (!res.ok || json.error) throw new Error(`Redis error: ${json.error || `HTTP ${res.status}`}`);
    return json.result;
  }

  async create(input) {
    const now = new Date().toISOString();
    const task = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now };
    await this._cmd(['HSET', this.key, task.id, JSON.stringify(task)]);
    return task;
  }

  async get(id) {
    const raw = await this._cmd(['HGET', this.key, id]);
    return raw ? JSON.parse(raw) : null;
  }

  async list({ status, limit = 50 } = {}) {
    const flat = (await this._cmd(['HGETALL', this.key])) || [];
    let items = [];
    if (Array.isArray(flat)) {
      for (let i = 1; i < flat.length; i += 2) items.push(JSON.parse(flat[i]));
    } else {
      items = Object.values(flat).map((v) => JSON.parse(v)); // object form, just in case
    }
    if (status) items = items.filter((t) => t.status === status);
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return items.slice(0, limit);
  }

  async update(id, patch) {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this._cmd(['HSET', this.key, id, JSON.stringify(updated)]);
    return updated;
  }
}

module.exports = { RedisStore };
