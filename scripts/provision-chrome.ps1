[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('Install', 'Verify')]
    [string]$Operation = 'Verify'
)

$ErrorActionPreference = 'Stop'
$script:ChromePolicyPath = 'HKLM:\Software\Policies\Google\Chrome'
$script:TampermonkeyBetaId = 'gcalenpjmijncebpfijmoaglllgpjagf'
$script:TampermonkeyPolicy = @{
    installation_mode = 'force_installed'
    update_url = 'https://clients2.google.com/service/update2/crx'
    minimum_version_required = '5.6'
}

function Read-ChromeExtensionPolicy {
    if (-not (Test-Path -LiteralPath $script:ChromePolicyPath)) { return @{} }
    $properties = Get-ItemProperty -LiteralPath $script:ChromePolicyPath -ErrorAction Stop
    $property = $properties.PSObject.Properties['ExtensionSettings']
    if ($null -eq $property) { return @{} }
    $document = ConvertFrom-Json -InputObject $property.Value -AsHashtable -ErrorAction Stop
    if ($document -isnot [System.Collections.IDictionary]) {
        throw 'Chrome ExtensionSettings must be a JSON object.'
    }
    return $document
}

function Get-TampermonkeyPolicyState {
    param([System.Collections.IDictionary]$Document)
    if (-not $Document.Contains($script:TampermonkeyBetaId)) { return 'Absent' }
    $existing = $Document[$script:TampermonkeyBetaId]
    if ($existing -isnot [System.Collections.IDictionary]) { return 'Conflict' }
    foreach ($name in $script:TampermonkeyPolicy.Keys) {
        if ($existing[$name] -cne $script:TampermonkeyPolicy[$name]) { return 'Conflict' }
    }
    return 'Present'
}

function Read-ChromeDebugPolicyState {
    foreach ($name in @('DeveloperToolsAvailabilityAllowlist', 'DeveloperToolsAvailabilityBlocklist')) {
        if (Test-Path -LiteralPath (Join-Path $script:ChromePolicyPath $name)) { return 'Conflict' }
    }
    if (-not (Test-Path -LiteralPath $script:ChromePolicyPath)) { return 'Absent' }
    $properties = Get-ItemProperty -LiteralPath $script:ChromePolicyPath
    $legacy = $properties.PSObject.Properties['DeveloperToolsDisabled']
    if ($null -ne $legacy -and $legacy.Value) { return 'Conflict' }
    $availability = $properties.PSObject.Properties['DeveloperToolsAvailability']
    if ($null -eq $availability) { return 'Absent' }
    if ($availability.Value -eq 1) { return 'Present' }
    return 'Conflict'
}

function Install-TampermonkeyDebugPolicy {
    if ((Read-ChromeDebugPolicyState) -ne 'Absent') { throw 'Only an absent Chrome debug policy can be installed.' }
    if (-not (Test-Path -LiteralPath $script:ChromePolicyPath)) { New-Item -Path $script:ChromePolicyPath | Out-Null }
    New-ItemProperty -LiteralPath $script:ChromePolicyPath -Name 'DeveloperToolsAvailability' -PropertyType DWord -Value 1 | Out-Null
    if ((Read-ChromeDebugPolicyState) -ne 'Present') { throw 'Chrome extension debugging policy write verification failed.' }
}

function Install-TampermonkeyPolicy {
    param([System.Collections.IDictionary]$Document)
    if ((Get-TampermonkeyPolicyState $Document) -ne 'Absent') {
        throw 'Only an absent Tampermonkey policy can be installed. Existing policy is never replaced.'
    }
    $Document[$script:TampermonkeyBetaId] = $script:TampermonkeyPolicy.Clone()
    $json = ConvertTo-Json -InputObject $Document -Depth 100 -Compress
    if (-not (Test-Path -LiteralPath $script:ChromePolicyPath)) { New-Item -Path $script:ChromePolicyPath | Out-Null }
    New-ItemProperty -LiteralPath $script:ChromePolicyPath -Name 'ExtensionSettings' -PropertyType String -Value $json -Force | Out-Null
    if ((Get-TampermonkeyPolicyState (Read-ChromeExtensionPolicy)) -ne 'Present') {
        throw 'Chrome policy write verification failed.'
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    if (-not $IsWindows -or $PSVersionTable.PSVersion.Major -lt 7) {
        throw 'Chrome provisioning requires Windows and PowerShell 7.'
    }
    $document = Read-ChromeExtensionPolicy
    $state = Get-TampermonkeyPolicyState $document
    $debugState = Read-ChromeDebugPolicyState
    if ($state -eq 'Conflict' -or $debugState -eq 'Conflict') { throw 'Existing Chrome policy conflicts with the required policy. No setting was changed.' }
    if ($state -eq 'Absent' -or $debugState -eq 'Absent') {
        if ($Operation -eq 'Verify') { throw 'Tampermonkey Beta Chrome provisioning is incomplete. Run this script with -Operation Install from an elevated PowerShell.' }
        $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'Installation requires an already elevated shell. This script does not invoke UAC.'
        }
        if ($PSCmdlet.ShouldProcess('HKLM Chrome policies', 'Install official Tampermonkey Beta and enable Chrome developer tools in all contexts, including managed extensions; preserve existing compatible policies')) {
            if ($state -eq 'Absent') { Install-TampermonkeyPolicy $document }
            if ($debugState -eq 'Absent') { Install-TampermonkeyDebugPolicy }
            Write-Output 'Tampermonkey Beta Chrome policy installed and verified.'
        }
    } else {
        Write-Output 'Tampermonkey Beta Chrome policy verified.'
    }
}
