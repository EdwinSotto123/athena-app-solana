# Athena AI – Cloud Function (Vertex AI)

Replaces the in-browser `@google/genai` calls with a server-side endpoint that
runs on Google Cloud Functions Gen 2 (Node.js 20) and talks to **Vertex AI**
through Application Default Credentials.

```
Frontend (SPA)  --POST--->  Cloud Function (this folder)  --SDK-->  Vertex AI / Gemini
                                            ^
                                     no API keys needed
                                  (uses the function's SA)
```

## Endpoint

```
POST  https://<region>-<project>.cloudfunctions.net/athena-ai
GET   https://<region>-<project>.cloudfunctions.net/athena-ai     -> health check
```

### Body

```json
// Chat / planner
{
  "action": "chat",
  "history": [
    { "role": "user",      "text": "Hi" },
    { "role": "assistant", "text": "Hi, I'm Athena..." }
  ],
  "message": "I'm not safe at home"
}
```

```json
// Forensic analysis
{
  "action": "analyze-evidence",
  "evidenceType": "TEXT" | "IMAGE" | "VIDEO" | "AUDIO",
  "data": "raw text" | "data:image/jpeg;base64,..."
}
```

### Optional auth

If `ATHENA_SHARED_SECRET` is set as a function env var, callers must send
`x-api-key: <secret>`. Leave it unset for fully public access (demo mode).

## Local run

```bash
cd backend/cloud_function/athena-ai
npm install
gcloud auth application-default login            # one-time
npm start                                         # listens on :8080
node test-local.js                                # smoke test
```

## Deploy

```bash
# pwsh
./deploy.ps1

# or bash / WSL
./deploy.sh
```

The script defaults to:
- project `vivid-spot-480905-a4`
- region  `us-central1`
- name    `athena-ai`

Override with env vars:

```bash
GCP_PROJECT_ID=other-project VERTEX_LOCATION=us-east1 FUNCTION_NAME=athena-ai-staging ./deploy.sh
```

## After deploy

Copy the printed URL into the frontend `.env` / `.env.local`:

```
VITE_AI_ENDPOINT_URL=https://us-central1-vivid-spot-480905-a4.cloudfunctions.net/athena-ai
# Optional, only if you set ATHENA_SHARED_SECRET on the function:
VITE_AI_SHARED_SECRET=your-shared-secret
```

Then restart `npm run dev` so Vite picks up the new env var.

## Required IAM (one-time)

The default Cloud Functions service account
(`<project-number>-compute@developer.gserviceaccount.com`) needs:

- `roles/aiplatform.user` (Vertex AI User)
- `roles/run.invoker`  (set automatically by `--allow-unauthenticated`)

```bash
PROJECT_NUMBER=$(gcloud projects describe vivid-spot-480905-a4 --format='value(projectNumber)')
gcloud projects add-iam-policy-binding vivid-spot-480905-a4 \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

## Required APIs (one-time)

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  --project=vivid-spot-480905-a4
```
