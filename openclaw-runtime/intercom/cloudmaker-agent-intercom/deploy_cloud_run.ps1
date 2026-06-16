# deploy_cloud_run.ps1
# Deploy cloudmaker-agent-intercom to Google Cloud Run
# Uses existing Firestore database and Secret Manager secrets

$ErrorActionPreference = "Stop"

$PROJECT = "iron-crane-485322-i6"
$REGION = "europe-west2"
$SERVICE_NAME = "cloudmaker-agent-intercom"
$SOURCE_DIR = $PSScriptRoot

Write-Host "=== CLOUDMAKER AGENT INTERCOM — CLOUD RUN DEPLOYMENT ===" -ForegroundColor Cyan
Write-Host "Project: $PROJECT"
Write-Host "Region: $REGION"
Write-Host "Service: $SERVICE_NAME"
Write-Host "Source: $SOURCE_DIR"
Write-Host ""

# Step 1: Verify secrets exist
Write-Host "[1/3] Verifying Secret Manager secrets..." -ForegroundColor Yellow
$secrets = gcloud secrets list --format="value(NAME)" --project=$PROJECT 2>&1
if ($secrets -notmatch "INTERCOM_API_KEY") {
    Write-Host "ERROR: INTERCOM_API_KEY secret not found in Secret Manager" -ForegroundColor Red
    exit 1
}
Write-Host "  INTERCOM_API_KEY: EXISTS" -ForegroundColor Green

# Step 2: Deploy to Cloud Run
Write-Host ""
Write-Host "[2/3] Deploying to Cloud Run..." -ForegroundColor Yellow
Write-Host "  This will build the Docker image and deploy it."
Write-Host "  Expected time: 2-5 minutes."
Write-Host ""

gcloud run deploy $SERVICE_NAME `
    --source $SOURCE_DIR `
    --project $PROJECT `
    --region $REGION `
    --platform managed `
    --allow-unauthenticated `
    --port 8080 `
    --memory 256Mi `
    --cpu 1 `
    --min-instances 0 `
    --max-instances 2 `
    --timeout 60 `
    --set-env-vars "NODE_ENV=production,STORAGE_TYPE=firestore,PORT=8080" `
    --set-secrets "INTERCOM_API_KEY=INTERCOM_API_KEY:latest" `
    --quiet

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Cloud Run deployment failed" -ForegroundColor Red
    exit 1
}

# Step 3: Verify deployment
Write-Host ""
Write-Host "[3/3] Verifying deployment..." -ForegroundColor Yellow
$SERVICE_URL = gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT --format="value(status.url)" 2>&1
Write-Host "  Service URL: $SERVICE_URL" -ForegroundColor Green

# Health check
Write-Host "  Running health check..."
$health = Invoke-RestMethod -Uri "$SERVICE_URL/health" -Method Get -ErrorAction SilentlyContinue
if ($health.status -eq "ok") {
    Write-Host "  Health: OK" -ForegroundColor Green
    Write-Host "  Environment: $($health.environment)" -ForegroundColor Green
    Write-Host "  Storage: $($health.storage)" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Health check returned unexpected response" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== DEPLOYMENT COMPLETE ===" -ForegroundColor Cyan
Write-Host "Service URL: $SERVICE_URL"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Run smoke test: node test_local_spine.js (update INTERCOM_API_URL to $SERVICE_URL)"
Write-Host "  2. Update worker configs with INTERCOM_API_URL=$SERVICE_URL"
Write-Host "  3. Add INTERCOM_API_URL as GitHub repo secret"
