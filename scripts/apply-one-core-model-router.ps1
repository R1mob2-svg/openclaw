#Requires -Version 5.1
<#
 Local AG handoff: make existing Windows OpenClaw use the SAME authenticated
 cost/router proxy as cloud NEO, without changing its brain, tools or jobs.
 Secrets must be injected as process environment, NEVER hardcoded in config.
 Usage: .\scripts\apply-one-core-model-router.ps1
 Dependencies: OPENCLAW_MODEL_PROXY_BASE_URL, GEMINX_OPENCLAW_GATEWAY_TOKEN.
 The backend will call free Gemini only if that API project's free-tier status
 and free-data use have independently been approved there.
#>
[CmdletBinding()]
param([string]$CliPath = "openclaw", [switch]$DryRun)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$base = [string]$env:OPENCLAW_MODEL_PROXY_BASE_URL
$bearer = [string]$env:GEMINX_OPENCLAW_GATEWAY_TOKEN
if ([string]::IsNullOrWhiteSpace($base) -or $base -notmatch '^https://') {
  throw "MODEL_CORE_BLOCKED: provide an HTTPS OPENCLAW_MODEL_PROXY_BASE_URL from the canonical GeminX backend"
}
if ([string]::IsNullOrWhiteSpace($bearer) -or $bearer.Length -lt 20) {
  throw "MODEL_CORE_BLOCKED: authenticated GEMINX_OPENCLAW_GATEWAY_TOKEN required in protected runtime env"
}
$null = Get-Command $CliPath -ErrorAction Stop
$config = Join-Path $HOME ".openclaw\openclaw.json"
if (-not (Test-Path -LiteralPath $config -PathType Leaf)) {
  throw "MODEL_CORE_BLOCKED: local canonical OpenClaw config absent"
}
$previousPrimary = (& $CliPath config get agents.defaults.model.primary | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw "MODEL_CORE_BLOCKED: existing model primary unreadable" }
Write-Output ("MODEL_CORE_PREVIOUS_PRIMARY=" + $previousPrimary)

# Auth test must be made with a deliberately INVALID model, so it cannot
# consume even one paid/free inference request. 400 proves gateway bearer auth.
if (-not $DryRun) {
  $headers = @{ Authorization = "Bearer $bearer"; "Content-Type" = "application/json" }
  $body = '{"model":"invalid-model-auth-test","messages":[{"role":"user","content":"auth test only"}]}'
  try {
    $r = Invoke-WebRequest -Uri ($base.TrimEnd('/') + "/chat/completions") -Method Post -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 15
    throw "MODEL_CORE_BLOCKED: unexpected upstream success on invalid model"
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -ne 400) { throw "MODEL_CORE_BLOCKED: authenticated proxy invalid-model probe expected 400, got $code" }
  }
  Write-Output "MODEL_CORE_AUTH_PROOF=HTTP_400_INVALID_MODEL_NO_INFERENCE"
}

$provider = @{
  baseUrl = $base.TrimEnd('/')
  apiKey = @{source="env";provider="default";id="GEMINX_OPENCLAW_GATEWAY_TOKEN"}
  authHeader = $true
  api = "openai-completions"
  models = @(
    @{
      id = "geminx-auto"; name = "Gemini Free First, Metered DeepSeek Flash"
      reasoning = $false; input = @("text")
      contextWindow = 96000; maxTokens = 4096
      cost = @{input=0.30;output=1.20;cacheRead=0.006;cacheWrite=0}
    },
    @{
      id = "deepseek-flash"; name = "DeepSeek Flash Explicit"
      reasoning = $false; input = @("text")
      contextWindow = 96000; maxTokens = 8192
      cost = @{input=0.30;output=1.20;cacheRead=0.006;cacheWrite=0}
    }
  )
} | ConvertTo-Json -Depth 12 -Compress

if ($DryRun) {
  Write-Output "MODEL_CORE_DRY_RUN=true; existing model and jobs unmodified"
  exit 0
}
$backup = "$config.bak-model-core-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $config -Destination $backup -ErrorAction Stop
try {
  & $CliPath config set models.providers.geminx-deepseek $provider --strict-json --replace | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "provider setup failed" }
  & $CliPath config set agents.defaults.model.primary "geminx-deepseek/geminx-auto" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "primary model setup failed" }
  & $CliPath config set agents.defaults.model.fallbacks "[]" --strict-json | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "fallback setup failed" }
  & $CliPath config set agents.defaults.heartbeat.every "0m" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "model heartbeat setup failed" }
  & $CliPath config validate | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "OpenClaw config validation failed" }
  $readback = (& $CliPath config get agents.defaults.model.primary | Out-String).Trim()
  if ($readback -notmatch 'geminx-deepseek/geminx-auto') { throw "model route readback mismatch" }
  Write-Output "MODEL_CORE_LOCAL_CONFIG_VALIDATED=true"
  Write-Output ("MODEL_CORE_PRIMARY=" + $readback)
  Write-Output "MODEL_CORE_BUDGET=ENFORCED_IN_CANONICAL_GEMINX_PROXY"
  Write-Output "MODEL_CORE_GOOGLE_TIER=GATED_IN_CANONICAL_GEMINX_PROXY"
} catch {
  Copy-Item -LiteralPath $backup -Destination $config -Force
  Write-Warning ("MODEL_CORE_LOCAL_ROLLBACK=RESTORED cause=" + $_.Exception.Message)
  throw
}
