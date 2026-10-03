$ErrorActionPreference = 'Stop'
Import-Module Pester -RequiredVersion 6.2.0
$result = Invoke-Pester -Path "$PSScriptRoot/../tests/provision-chrome.Tests.ps1" -PassThru -Output Detailed
if ($result.FailedCount -gt 0 -or $result.TotalCount -eq 0 -or $result.SkippedCount -gt 0) { exit 1 }
