// Vercel Function: GET /tasks/{id} and PATCH /tasks/{id}
import adapter from '../../src/lib/web-adapter.js';
import tasks from '../../src/handlers/tasks.js';

export default {
  fetch: adapter.route({ GET: tasks.getTask, PATCH: tasks.updateTask }, { idFromPath: true }),
};
