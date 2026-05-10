# Deploys the Athena AI Cloud Function (Gen 2) using Application Default Credentials.
# Run from the project root or from this folder; both work.

$ErrorActionPreference = 'Stop'

# Resolve script location so it works regardless of caller cwd.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $here

try {
  $project  = if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { 'vivid-spot-480905-a4' }
  $region   = if ($env:VERTEX_LOCATION) { $env:VERTEX_LOCATION } else { 'us-central1' }
  $name     = if ($env:FUNCTION_NAME) { $env:FUNCTION_NAME } else { 'athena-ai' }
  $allowed  = if ($env:CORS_ALLOWED_ORIGINS) { $env:CORS_ALLOWED_ORIGINS } else { '*' }
  $secret   = $env:ATHENA_SHARED_SECRET

  Write-Host "==> Deploying $name to $project / $region"

  $envVars = @(
    "GCP_PROJECT_ID=$project",
    "VERTEX_LOCATION=$region",
    "CORS_ALLOWED_ORIGINS=$allowed"
  )
  if ($secret) { $envVars += "ATHENA_SHARED_SECRET=$secret" }
  $envVarsArg = ($envVars -join ',')

  gcloud functions deploy $name `
    --gen2 `
    --runtime=nodejs22 `
    --region=$region `
    --source=. `
    --entry-point=athenaAi `
    --trigger-http `
    --allow-unauthenticated `
    --memory=512Mi `
    --timeout=120s `
    --max-instances=10 `
    --set-env-vars=$envVarsArg `
    --project=$project

  if ($LASTEXITCODE -ne 0) { throw "gcloud functions deploy failed with code $LASTEXITCODE" }

  Write-Host ""
  Write-Host "==> Function URL:"
  gcloud functions describe $name --gen2 --region=$region --project=$project --format='value(serviceConfig.uri)'
}
finally {
  Pop-Location
}
