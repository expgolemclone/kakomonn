BeforeAll {
    . "$PSScriptRoot/../scripts/provision-chrome.ps1"
}

Describe 'Chrome Tampermonkey policy provisioning' {
    It 'reports an absent policy' {
        Get-TampermonkeyPolicyState @{} | Should -Be 'Absent'
    }
    It 'accepts the required official policy' {
        Get-TampermonkeyPolicyState @{$script:TampermonkeyBetaId = $script:TampermonkeyPolicy.Clone()} | Should -Be 'Present'
    }
    It 'rejects a malformed extension entry' {
        Get-TampermonkeyPolicyState @{$script:TampermonkeyBetaId = 'invalid'} | Should -Be 'Conflict'
    }
    It 'rejects each incompatible field without replacing it' -ForEach @(
        @{ Field = 'installation_mode'; Value = 'blocked' }
        @{ Field = 'update_url'; Value = 'https://untrusted.example.test/update' }
        @{ Field = 'minimum_version_required'; Value = '5.5' }
    ) {
        $policy = $script:TampermonkeyPolicy.Clone()
        $policy[$Field] = $Value
        $document = @{$script:TampermonkeyBetaId = $policy}
        Get-TampermonkeyPolicyState $document | Should -Be 'Conflict'
        { Install-TampermonkeyPolicy $document } | Should -Throw '*never replaced*'
        $document[$script:TampermonkeyBetaId][$Field] | Should -Be $Value
    }
    It 'does not duplicate an already installed policy' {
        { Install-TampermonkeyPolicy @{$script:TampermonkeyBetaId = $script:TampermonkeyPolicy.Clone()} } | Should -Throw '*never replaced*'
    }
    It 'preserves unrelated policy fields while adding exactly one extension' {
        $document = @{ '*' = @{ installation_mode = 'blocked' }; 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' = @{ installation_mode = 'allowed' } }
        $script:written = $null
        Mock New-Item { }
        Mock New-ItemProperty { $script:written = $Value | ConvertFrom-Json -AsHashtable }
        Mock Read-ChromeExtensionPolicy { $script:written }
        Install-TampermonkeyPolicy $document
        $script:written.Count | Should -Be 3
        $script:written['*'].installation_mode | Should -Be 'blocked'
        $script:written['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'].installation_mode | Should -Be 'allowed'
        Get-TampermonkeyPolicyState $script:written | Should -Be 'Present'
        Should -Invoke New-ItemProperty -Times 1 -Exactly -ParameterFilter { $Name -eq 'ExtensionSettings' -and $PropertyType -eq 'String' }
    }
    It 'does not recreate an existing registry key when adding extension settings' {
        Mock Test-Path { $true }
        Mock New-Item { throw 'Existing registry keys must not be recreated' }
        Mock New-ItemProperty { }
        Mock Read-ChromeExtensionPolicy { @{$script:TampermonkeyBetaId = $script:TampermonkeyPolicy.Clone()} }
        Install-TampermonkeyPolicy @{}
        Should -Invoke New-Item -Times 0 -Exactly
    }
    It 'does not recreate an existing registry key when enabling developer tools' {
        $script:debugReads = 0
        Mock Read-ChromeDebugPolicyState { $script:debugReads++; if ($script:debugReads -eq 1) { 'Absent' } else { 'Present' } }
        Mock Test-Path { $true }
        Mock New-Item { throw 'Existing registry keys must not be recreated' }
        Mock New-ItemProperty { }
        Install-TampermonkeyDebugPolicy
        Should -Invoke New-Item -Times 0 -Exactly
    }
    It 'fails when the stored policy does not match the write' {
        Mock New-Item { }
        Mock New-ItemProperty { }
        Mock Read-ChromeExtensionPolicy { @{} }
        { Install-TampermonkeyPolicy @{} } | Should -Throw '*verification failed*'
    }
    It 'accepts developer tools enabled in all contexts' {
        Mock Test-Path { $LiteralPath -eq $script:ChromePolicyPath }
        Mock Get-ItemProperty { [pscustomobject]@{ DeveloperToolsAvailability = 1 } }
        Read-ChromeDebugPolicyState | Should -Be 'Present'
    }
    It 'reports absent debugging policy without mutating it' {
        Mock Test-Path { $false }
        Read-ChromeDebugPolicyState | Should -Be 'Absent'
    }
    It 'rejects existing global debugging denial' {
        Mock Test-Path { $LiteralPath -eq $script:ChromePolicyPath }
        Mock Get-ItemProperty { [pscustomobject]@{ DeveloperToolsAvailability = 2 } }
        Read-ChromeDebugPolicyState | Should -Be 'Conflict'
    }
    It 'rejects an existing allowlist for another origin' {
        Mock Test-Path { $true }
        Mock Get-ItemProperty {
            if ($LiteralPath.EndsWith('DeveloperToolsAvailabilityAllowlist')) { return [pscustomobject]@{ '1' = 'https://other.example.test/' } }
            return [pscustomobject]@{}
        }
        Read-ChromeDebugPolicyState | Should -Be 'Conflict'
    }
    It 'preserves an existing blocklist rather than clearing it' {
        Mock Test-Path { $true }
        Mock Get-ItemProperty {
            if ($LiteralPath.EndsWith('DeveloperToolsAvailabilityAllowlist')) { return [pscustomobject]@{ '1' = "chrome-extension://$script:TampermonkeyBetaId/" } }
            if ($LiteralPath.EndsWith('DeveloperToolsAvailabilityBlocklist')) { return [pscustomobject]@{ '1' = 'https://blocked.example.test/' } }
            return [pscustomobject]@{}
        }
        Read-ChromeDebugPolicyState | Should -Be 'Conflict'
    }
    It 'verifies the explicit developer tools policy write' {
        $script:debugReads = 0
        Mock Read-ChromeDebugPolicyState { $script:debugReads++; if ($script:debugReads -eq 1) { 'Absent' } else { 'Present' } }
        Mock Test-Path { $false }
        Mock New-Item { }
        Mock New-ItemProperty { }
        Install-TampermonkeyDebugPolicy
        Should -Invoke New-ItemProperty -Times 1 -Exactly -ParameterFilter { $LiteralPath -eq $script:ChromePolicyPath -and $Name -eq 'DeveloperToolsAvailability' -and $PropertyType -eq 'DWord' -and $Value -eq 1 }
        Should -Invoke New-Item -Times 1 -Exactly -ParameterFilter { $Path -eq $script:ChromePolicyPath }
    }
    It 'returns an empty document when the registry key is absent' {
        Mock Test-Path { $false }
        Read-ChromeExtensionPolicy | Should -BeOfType [hashtable]
        (Read-ChromeExtensionPolicy).Count | Should -Be 0
    }
    It 'rejects non-object policy JSON rather than discarding it' {
        Mock Test-Path { $true }
        Mock Get-ItemProperty { [pscustomobject]@{ ExtensionSettings = '[]' } }
        { Read-ChromeExtensionPolicy } | Should -Throw '*JSON object*'
    }
}
