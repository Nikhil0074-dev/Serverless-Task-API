'use strict';
// Dependency-free request validation. Returns { valid, errors, value } — never throws.

const STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const LIMITS = { title: 120, description: 1000 };

const isPlainObject = (v) => Object.prototype.toString.call(v) === '[object Object]';

function isValidDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(str);
}

function validateTask(payload, { partial = false } = {}) {
  const errors = [];
  if (!isPlainObject(payload)) {
    return { valid: false, errors: [{ field: 'body', message: 'Body must be a JSON object' }], value: null };
  }

  const allowed = ['title', 'description', 'status', 'priority', 'dueDate'];
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) errors.push({ field: key, message: 'Unknown field' });
  }

  if (!partial || 'title' in payload) {
    if (typeof payload.title !== 'string' || payload.title.trim() === '') {
      errors.push({ field: 'title', message: 'title is required and must be a non-empty string' });
    } else if (payload.title.trim().length > LIMITS.title) {
      errors.push({ field: 'title', message: `title must be at most ${LIMITS.title} characters` });
    }
  }
  if ('description' in payload && (typeof payload.description !== 'string' || payload.description.length > LIMITS.description)) {
    errors.push({ field: 'description', message: `description must be a string up to ${LIMITS.description} characters` });
  }
  if ('status' in payload && !STATUSES.includes(payload.status)) {
    errors.push({ field: 'status', message: `status must be one of: ${STATUSES.join(', ')}` });
  }
  if ('priority' in payload && !PRIORITIES.includes(payload.priority)) {
    errors.push({ field: 'priority', message: `priority must be one of: ${PRIORITIES.join(', ')}` });
  }
  if ('dueDate' in payload && payload.dueDate !== null && !isValidDate(payload.dueDate)) {
    errors.push({ field: 'dueDate', message: 'dueDate must be a valid date in YYYY-MM-DD format (or null)' });
  }
  if (partial && Object.keys(payload).length === 0) {
    errors.push({ field: 'body', message: 'Provide at least one field to update' });
  }

  if (errors.length) return { valid: false, errors, value: null };

  const value = {};
  if ('title' in payload) value.title = payload.title.trim();
  if ('description' in payload) value.description = payload.description;
  if ('status' in payload) value.status = payload.status;
  if ('priority' in payload) value.priority = payload.priority;
  if ('dueDate' in payload) value.dueDate = payload.dueDate;
  return { valid: true, errors: [], value };
}

// UUID v1-v5 pattern
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidId = (id) => typeof id === 'string' && UUID_RE.test(id);

module.exports = { validateTask, isValidId, STATUSES, PRIORITIES, LIMITS };
