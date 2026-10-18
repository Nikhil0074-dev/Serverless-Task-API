// Vercel Function: POST /tasks and GET /tasks  (vercel.json rewrites /tasks -> /api/tasks)
import adapter from '../../src/lib/web-adapter.js';
import tasks from '../../src/handlers/tasks.js';

export default {
  fetch: adapter.route({ POST: tasks.createTask, GET: tasks.listTasks }),
};
