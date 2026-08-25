[CmdletBinding()]
param(
    [string]$BaseUrl = "https://kakomonn-sync.kakomonn.workers.dev/v8",
    [string]$Site
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-Property {
    param(
        [Parameter(Mandatory)] [object]$Object,
        [Parameter(Mandatory)] [string]$Name
    )
    return $null -ne $Object.PSObject.Properties[$Name]
}

function Test-SafeInteger {
    param(
        [object]$Value,
        [switch]$NonNegative,
        [switch]$Positive
    )

    if ($null -eq $Value -or $Value -is [bool]) {
        return $false
    }

    try {
        $number = [decimal]$Value
    }
    catch {
        return $false
    }

    if ([decimal]::Truncate($number) -ne $number) {
        return $false
    }

    if ($number -lt -9007199254740991 -or $number -gt 9007199254740991) {
        return $false
    }

    if ($NonNegative -and $number -lt 0) {
        return $false
    }

    if ($Positive -and $number -le 0) {
        return $false
    }

    return $true
}

function Get-StateContractErrors {
    param(
        [Parameter(Mandatory)] [object]$Body,
        [Parameter(Mandatory)] [string]$ExpectedSite
    )

    $errors = [System.Collections.Generic.List[string]]::new()

    if (-not (Test-Property $Body "site") -or $Body.site -ne $ExpectedSite) {
        $errors.Add("site must equal '$ExpectedSite'")
    }

    if (
        -not (Test-Property $Body "today") -or
        $Body.today -isnot [string] -or
        $Body.today -notmatch '^\d{4}-\d{2}-\d{2}$'
    ) {
        $errors.Add("today must match YYYY-MM-DD")
    }

    if (-not (Test-Property $Body "learningMetrics") -or $null -eq $Body.learningMetrics) {
        $errors.Add("learningMetrics is missing")
    }
    else {
        $metrics = $Body.learningMetrics
        if (-not (Test-Property $metrics "stabilityDays") -or -not (Test-SafeInteger $metrics.stabilityDays -NonNegative)) {
            $errors.Add("learningMetrics.stabilityDays must be a non-negative safe integer")
        }
        if (-not (Test-Property $metrics "todayStabilityDaysDelta") -or -not (Test-SafeInteger $metrics.todayStabilityDaysDelta)) {
            $errors.Add("learningMetrics.todayStabilityDaysDelta must be a safe integer")
        }
        if (-not (Test-Property $metrics "attemptedQuestionCount") -or -not (Test-SafeInteger $metrics.attemptedQuestionCount -NonNegative)) {
            $errors.Add("learningMetrics.attemptedQuestionCount must be a non-negative safe integer")
        }
        if (-not (Test-Property $metrics "todayAttemptedQuestionCount") -or -not (Test-SafeInteger $metrics.todayAttemptedQuestionCount -NonNegative)) {
            $errors.Add("learningMetrics.todayAttemptedQuestionCount must be a non-negative safe integer")
        }
    }

    if (-not (Test-Property $Body "catalog")) {
        $errors.Add("catalog property is missing")
    }
    elseif ($null -ne $Body.catalog) {
        $catalog = $Body.catalog
        if (-not (Test-Property $catalog "questionCount") -or -not (Test-SafeInteger $catalog.questionCount -Positive)) {
            $errors.Add("catalog.questionCount must be a positive safe integer")
        }
        if (-not (Test-Property $catalog "updatedAtMs") -or -not (Test-SafeInteger $catalog.updatedAtMs -Positive)) {
            $errors.Add("catalog.updatedAtMs must be a positive safe integer")
        }
        if (-not (Test-Property $catalog "generation") -or -not (Test-SafeInteger $catalog.generation -Positive)) {
            $errors.Add("catalog.generation must be a positive safe integer")
        }
    }

    return $errors
}

function Get-NextContractErrors {
    param(
        [Parameter(Mandatory)] [object]$Body,
        [Parameter(Mandatory)] [string]$ExpectedSite
    )

    $errors = [System.Collections.Generic.List[string]]::new()

    if (-not (Test-Property $Body "question")) {
        $errors.Add("question property is missing")
        return $errors
    }

    if ($null -eq $Body.question) {
        return $errors
    }

    $question = $Body.question
    if (-not (Test-Property $question "questionId") -or $question.questionId -isnot [string] -or $question.questionId -notmatch '^\d+$') {
        $errors.Add("question.questionId must contain digits only")
        return $errors
    }

    if (-not (Test-Property $question "url") -or $question.url -isnot [string]) {
        $errors.Add("question.url is missing")
    }
    else {
        try {
            $uri = [Uri]$question.url
            if ($uri.Scheme -ne "https" -or $uri.Host -ne $ExpectedSite) {
                $errors.Add("question.url origin does not match https://$ExpectedSite")
            }
            if ($uri.AbsolutePath -ne "/questions/$($question.questionId)") {
                $errors.Add("question.url path does not match questionId")
            }
            if ($uri.Query -ne "" -or $uri.Fragment -ne "") {
                $errors.Add("question.url must not contain query or fragment")
            }
        }
        catch {
            $errors.Add("question.url is not a valid URL")
        }
    }

    if (-not (Test-Property $question "kind") -or $question.kind -notin @("review", "new")) {
        $errors.Add("question.kind must be review or new")
    }

    if (-not (Test-Property $question "dueMs")) {
        $errors.Add("question.dueMs property is missing")
    }
    elseif ($null -ne $question.dueMs -and -not (Test-SafeInteger $question.dueMs)) {
        $errors.Add("question.dueMs must be null or a safe integer")
    }

    return $errors
}

function Convert-SecureStringToPlainText {
    param([Parameter(Mandatory)] [Security.SecureString]$SecureString)

    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

$secureToken = Read-Host "Sync token" -AsSecureString
$token = Convert-SecureStringToPlainText $secureToken
$headers = @{
    Authorization = "Bearer $token"
    Accept = "application/json"
}

function Invoke-DiagnosticRequest {
    param(
        [Parameter(Mandatory)] [string]$Path
    )

    $uri = "$BaseUrl$Path"
    $response = Invoke-WebRequest `
        -Uri $uri `
        -Method Get `
        -Headers $headers `
        -SkipHttpErrorCheck `
        -TimeoutSec 20

    $raw = [string]$response.Content
    $json = $null
    $jsonError = $null
    try {
        $json = $raw | ConvertFrom-Json -Depth 50
    }
    catch {
        $jsonError = $_.Exception.Message
    }

    $contentType = ($response.Headers["Content-Type"] -join ",")
    $cfRay = ($response.Headers["CF-Ray"] -join ",")

    return [pscustomobject]@{
        Uri = $uri
        Status = [int]$response.StatusCode
        ContentType = $contentType
        CfRay = $cfRay
        Raw = $raw
        Json = $json
        JsonError = $jsonError
    }
}

function Show-ResponseSummary {
    param(
        [Parameter(Mandatory)] [string]$Label,
        [Parameter(Mandatory)] [object]$Response
    )

    Write-Host ""
    Write-Host "=== $Label ==="
    Write-Host "HTTP: $($Response.Status)"
    Write-Host "Content-Type: $($Response.ContentType)"
    if ($Response.CfRay) {
        Write-Host "CF-Ray: $($Response.CfRay)"
    }
    if ($null -ne $Response.JsonError) {
        Write-Host "JSON parse: FAIL"
        Write-Host "Reason: $($Response.JsonError)"
        Write-Host "Raw body:"
        Write-Host $Response.Raw
    }
    else {
        Write-Host "JSON parse: PASS"
        Write-Host "Body:"
        Write-Host ($Response.Json | ConvertTo-Json -Depth 20)
    }
}

try {
    $sitesResponse = Invoke-DiagnosticRequest "/sites"
    Show-ResponseSummary "GET /v8/sites" $sitesResponse

    if ($sitesResponse.Status -ne 200) {
        Write-Host ""
        Write-Host "RESULT: authentication or production API error before schema validation."
        exit 1
    }
    if ($null -eq $sitesResponse.Json) {
        Write-Host ""
        Write-Host "RESULT: /sites returned HTTP 200 but non-JSON. The reader can report invalid_response for this class of failure."
        exit 2
    }
    if (-not (Test-Property $sitesResponse.Json "sites") -or $sitesResponse.Json.sites -isnot [System.Array]) {
        Write-Host ""
        Write-Host "RESULT: /sites response shape is unexpected."
        exit 3
    }

    $sites = @($sitesResponse.Json.sites)
    if ($Site) {
        $sites = @($Site)
    }

    if ($sites.Count -eq 0) {
        Write-Host ""
        Write-Host "RESULT: token is valid, but /sites returned no catalog sites."
        exit 4
    }

    $hadFailure = $false

    foreach ($currentSite in $sites) {
        Write-Host ""
        Write-Host "######## site: $currentSite ########"

        $encodedSite = [Uri]::EscapeDataString([string]$currentSite)
        $stateResponse = Invoke-DiagnosticRequest "/state?site=$encodedSite"
        Show-ResponseSummary "GET /v8/state" $stateResponse

        if ($stateResponse.Status -ne 200) {
            Write-Host "STATE CONTRACT: NOT TESTED, HTTP status is not 200."
            $hadFailure = $true
            continue
        }
        if ($null -eq $stateResponse.Json) {
            Write-Host "STATE CONTRACT: FAIL, HTTP 200 body is not JSON."
            $hadFailure = $true
            continue
        }

        $stateErrors = @(Get-StateContractErrors $stateResponse.Json ([string]$currentSite))
        if ($stateErrors.Count -eq 0) {
            Write-Host "STATE CONTRACT: PASS"
        }
        else {
            Write-Host "STATE CONTRACT: FAIL"
            foreach ($item in $stateErrors) {
                Write-Host " - $item"
            }
            $hadFailure = $true
            continue
        }

        if ($null -eq $stateResponse.Json.catalog) {
            Write-Host "CATALOG: null. The reader will crawl the question catalog and POST /v8/questions."
            Write-Host "NOTE: this script does not POST /v8/questions because that mutates production state."
        }
        else {
            $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            $ageMs = $nowMs - [long]$stateResponse.Json.catalog.updatedAtMs
            $ageHours = [Math]::Round($ageMs / 3600000.0, 2)
            Write-Host "CATALOG AGE HOURS: $ageHours"
            if ($ageMs -lt 0 -or $ageMs -ge 86400000) {
                Write-Host "CATALOG REFRESH: YES. The reader will crawl the catalog and POST /v8/questions."
                Write-Host "NOTE: if the browser error happens here, inspect the POST /v8/questions response in DevTools."
            }
            else {
                Write-Host "CATALOG REFRESH: NO"
            }
        }

        $nextResponse = Invoke-DiagnosticRequest "/next?site=$encodedSite"
        Show-ResponseSummary "GET /v8/next" $nextResponse
        if ($nextResponse.Status -eq 200 -and $null -ne $nextResponse.Json) {
            $nextErrors = @(Get-NextContractErrors $nextResponse.Json ([string]$currentSite))
            if ($nextErrors.Count -eq 0) {
                Write-Host "NEXT CONTRACT: PASS"
            }
            else {
                Write-Host "NEXT CONTRACT: FAIL"
                foreach ($item in $nextErrors) {
                    Write-Host " - $item"
                }
                $hadFailure = $true
            }
        }
        else {
            Write-Host "NEXT CONTRACT: NOT TESTED, response is not HTTP 200 JSON."
            $hadFailure = $true
        }
    }

    Write-Host ""
    if ($hadFailure) {
        Write-Host "RESULT: at least one production response does not satisfy the reader contract."
        exit 10
    }

    Write-Host "RESULT: non-mutating production endpoints satisfy the reader contract."
    Write-Host "If the reader still shows invalid_response, the remaining likely path is POST /v8/questions or POST /v8/attempts."
}
finally {
    $headers.Authorization = ""
    $token = ""
}
