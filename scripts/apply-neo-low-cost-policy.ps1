#Requires -Version 5.1
<#
 Applies ONLY the cost-safe OpenClaw session profile to the existing local
 Windows OpenClaw. Does not replace its identity, models, jobs, tools,
 credentials, Gateway, provider accounts or canonical Brain.
 Run from an authorised logged-in operator session, never by Remote shell
 with copied passwords. Example: .\scripts\apply-neo-low-cost-policy.ps1
#>
[CmdletBinding()]
param(
  [string]$CliPath = "openclaw",
  [switch]$ValidateOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$policy = @(
  @{ Key = "agents.defaults.heartbeat.every"; Value = "0m"; Json = $false },
  @{ Key = "agents.defaults.thinkingDefault"; Value = "off"; Json = $false },
  @{ Key = "agents.defaults.contextTokens"; Value = "96000"; Json = $true },
  @{ Key = "agents.defaults.compaction.reserveTokens"; Value = "24000"; Json = $true },
  @{ Key = "agents.defaults.compaction.keepRecentTokens"; Value = "12000"; Json = $true },
  @{ Key = "agents.defaults.compaction.maxActiveTranscriptBytes"; Value = '"4mb"'; Json = $true },
  @{ Key = "agents.defaults.compaction.midTurnPrecheck.enabled"; Value = "true"; Json = $true },
  @{ Key = "agents.defaults.compaction.truncateAfterCompaction"; Value = "true"; Json = $true }
)

function Invoke-OpenClaw {
  param([string[]]$Arguments)
  $output = & $CliPath @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "OpenClaw command failed ($LASTEXITCODE): $($Arguments[0..([Math]::Min($Arguments.Length - 1, 2))] -join ' ')"
  }
  return $output
}

$null = Get-Command $CliPath -ErrorAction Stop
$config = Join-Path $HOME ".openclaw\openclaw.json"
$backup = $null
if (-not $ValidateOnly) {
  if (-not (Test-Path $config -PathType Leaf)) { throw "Refusing to mutate: canonical OpenClaw config not found: $config" }
  $backup = "$config.bak-cost-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item -LiteralPath $config -Destination $backup -ErrorAction Stop
  Write-Output "COST_POLICY_BACKUP_CREATED=true (local protected config directory)"
}
try {
  foreach ($setting in $policy) {
    if (-not $ValidateOnly) {
      $args = @("config", "set", $setting.Key, $setting.Value)
      if ($setting.Json) { $args += "--strict-json" }
      $null = Invoke-OpenClaw -Arguments $args
    }
    $actual = (Invoke-OpenClaw -Arguments @("config", "get", $setting.Key) | Out-String).Trim()
    if (-not $actual) { throw "Missing readback: $($setting.Key)" }
    Write-Output ("COST_POLICY_READBACK={0}:{1}" -f $setting.Key, $actual)
  }
  $null = Invoke-OpenClaw -Arguments @("config", "validate")
  Write-Output "COST_POLICY_CONFIG_VALIDATED=true"
  $primary = (Invoke-OpenClaw -Arguments @("config", "get", "agents.defaults.model.primary") | Out-String).Trim()
  if ($primary -match "geminx-deepseek/" -or $primary -match "ollama") {
    Write-Output "COST_POLICY_MODEL_ROUTE_REVIEW=$primary"
  } else {
    Write-Output "COST_POLICY_MODEL_ROUTE_UNVERIFIED=true (do not claim a shared DeepSeek cap for direct providers)"
  }
  Write-Output "COST_POLICY_COMPLETE=true"
} catch {
  Write-Warning ("COST_POLICY_FAILED=" + $_.Exception.Message)
  if ($backup -and (Test-Path $backup -PathType Leaf)) {
    Copy-Item -LiteralPath $backup -Destination $config -Force
    Write-Output "COST_POLICY_RESTORED_PREVIOUS_CONFIG=true"
  }
  throw
}
