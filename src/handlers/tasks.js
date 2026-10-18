'use strict';

const { success, error, HttpError } = require('../lib/response');
const { getStore } = require('../lib/store');
const { validateCreate, validateUpdate, validateListQuery, isValidId } = require('../lib/validation');

const MAX_BODY_BYTES = 10 * 1024;

function parseBody(event) {
  if (event.body === undefined || event.body === null || event.body === '') {
    throw new HttpError(400, 'Request body is required');
  }
  let raw = event.body;
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw new HttpError(413, `Request body must be at most ${MAX_BODY_BYTES} bytes`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

function getId(event) {
  const id = event.pathParameters && event.pathParameters.id;
  if (!isValidId(id)) throw new HttpError(400, 'Task id must be a valid UUID');
  return id;
}

/** Wraps a handler so every error becomes a standard JSON response. */
function wrap(fn) {
  return async (event) => {
    try {
      return await fn(event || {});
    } catch (err) {
      if (err instanceof HttpError) return error(err.statusCode, err.message, err.details);
      console.error('Unhandled error:', err);
      return error(500, 'Internal server error');
    }
  };
}

const createTask = wrap(async (event) => {
  const { errors, value } = validateCreate(parseBody(event));
  if (errors.length) throw new HttpError(400, 'Validation failed', errors);
  const task = await getStore().create(value);
  return success(201, task, { Location: `/tasks/${task.id}` });
});

const getTask = wrap(async (event) => {
  const task = await getStore().get(getId(event));
  if (!task) throw new HttpError(404, 'Task not found');
  return success(200, task);
});

const listTasks = wrap(async (event) => {
  const { errors, value } = validateListQuery(event.queryStringParameters || {});
  if (errors.length) throw new HttpError(400, 'Validation failed', errors);
  const tasks = await getStore().list(value);
  return success(200, { items: tasks, count: tasks.length });
});

const updateTask = wrap(async (event) => {
  const id = getId(event);
  const { errors, value } = validateUpdate(parseBody(event));
  if (errors.length) throw new HttpError(400, 'Validation failed', errors);
  const task = await getStore().update(id, value);
  if (!task) throw new HttpError(404, 'Task not found');
  return success(200, task);
});

module.exports = { createTask, getTask, listTasks, updateTask };
