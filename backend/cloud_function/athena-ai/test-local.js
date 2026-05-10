/**
 * Smoke-test the function locally.
 *
 * Prereqs:
 *   - cd backend/cloud_function/athena-ai && npm install
 *   - gcloud auth application-default login   (one time)
 *   - npm start                                (starts on http://localhost:8080)
 *
 * Then in another terminal:
 *   node test-local.js
 */

const BASE = process.env.ATHENA_AI_URL || 'http://localhost:8080';

async function call(action, body) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  console.log(`[${action}] status=${res.status}`);
  console.log(await res.text());
  console.log('---');
}

(async () => {
  await call('chat', {
    history: [],
    message: 'Hi Athena, I am scared and need help thinking through a plan.',
  });

  await call('analyze-evidence', {
    evidenceType: 'TEXT',
    data: 'He yelled at me again and broke the kitchen door at 11pm.',
  });
})();
