'use strict';

const STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const ALLOWED_FIELDS = ['title', 'description', 'status', 'priority', 'dueDate'];
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isValidId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * Shared field checks. When `partial` is true, missing fields are fine.
 * Returns { errors: [{field, message}], value: {...cleaned} }.
 */
function checkFields(input, partial) {
  const errors = [];
  const value = {};

  if (!isPlainObject(input)) {
    return { errors: [{ field: 'body', message: 'must be a JSON object' }], value };
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.includes(key)) {
      errors.push({ field: key, message: 'is not an allowed field' });
    }
  }

  if (input.title === undefined) {
    if (!partial) errors.push({ field: 'title', message: 'is required' });
  } else if (typeof input.title !== 'string') {
    errors.push({ field: 'title', message: 'must be a string' });
  } else {
    const t = input.title.trim();
    if (t.length === 0) errors.push({ field: 'title', message: 'must not be empty' });
    else if (t.length > TITLE_MAX)
      errors.push({ field: 'title', message: `must be at most ${TITLE_MAX} characters` });
    else value.title = t;
  }

  if (input.description !== undefined) {
    if (typeof input.description !== 'string') {
      errors.push({ field: 'description', message: 'must be a string' });
    } else if (input.description.length > DESCRIPTION_MAX) {
      errors.push({
        field: 'description',
        message: `must be at most ${DESCRIPTION_MAX} characters`,
      });
    } else value.description = input.description;
  }

  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) {
      errors.push({ field: 'status', message: `must be one of: ${STATUSES.join(', ')}` });
    } else value.status = input.status;
  }

  if (input.priority !== undefined) {
    if (!PRIORITIES.includes(input.priority)) {
      errors.push({ field: 'priority', message: `must be one of: ${PRIORITIES.join(', ')}` });
    } else value.priority = input.priority;
  }

  if (input.dueDate !== undefined) {
    if (input.dueDate === null) value.dueDate = null;
    else if (!isValidDate(input.dueDate)) {
      errors.push({ field: 'dueDate', message: 'must be a valid date in YYYY-MM-DD format or null' });
    } else value.dueDate = input.dueDate;
  }

  return { errors, value };
}

function validateCreate(input) {
  const { errors, value } = checkFields(input, false);
  if (errors.length) return { errors, value: null };
  return {
    errors: [],
    value: {
      title: value.title,
      description: value.description ?? '',
      status: value.status ?? 'todo',
      priority: value.priority ?? 'medium',
      dueDate: value.dueDate ?? null,
    },
  };
}

function validateUpdate(input) {
  const { errors, value } = checkFields(input, true);
  if (!errors.length && Object.keys(value).length === 0) {
    errors.push({ field: 'body', message: 'must contain at least one field to update' });
  }
  if (errors.length) return { errors, value: null };
  return { errors: [], value };
}

function validateListQuery(query = {}) {
  const errors = [];
  const value = { limit: 50 };

  if (query.status !== undefined) {
    if (!STATUSES.includes(query.status)) {
      errors.push({ field: 'status', message: `must be one of: ${STATUSES.join(', ')}` });
    } else value.status = query.status;
  }

  if (query.limit !== undefined) {
    if (!/^\d+$/.test(String(query.limit))) {
      errors.push({ field: 'limit', message: 'must be an integer between 1 and 100' });
    } else {
      const n = Number(query.limit);
      if (n < 1 || n > 100) errors.push({ field: 'limit', message: 'must be an integer between 1 and 100' });
      else value.limit = n;
    }
  }

  return errors.length ? { errors, value: null } : { errors: [], value };
}

module.exports = {
  STATUSES,
  PRIORITIES,
  validateCreate,
  validateUpdate,
  validateListQuery,
  isValidId,
};
