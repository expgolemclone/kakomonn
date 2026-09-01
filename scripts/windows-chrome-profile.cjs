const { spawnSync } = require("node:child_process");
const path = require("node:path");

const CHROME_AUTOPLAY_ARGUMENT =
  "--autoplay-policy=no-user-gesture-required";
const CHROME_REMOTE_DEBUGGING_ARGUMENT = "--remote-debugging-port=0";

function isSameOrDescendantPath(parentPath, candidatePath, pathApi = path) {
  const relative = pathApi.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${pathApi.sep}`) &&
      relative !== ".." &&
      !pathApi.isAbsolute(relative))
  );
}

function windowsPowerShellExecutable(environment = process.env) {
  const systemRoot = environment.SystemRoot;
  if (!systemRoot) {
    throw new Error("SystemRoot is not set");
  }
  return path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

function subprocessEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith("KAKOMONN_")),
  );
}

const dedicatedChromeProcessPowerShell = String.raw`
function Get-ChromeUserDataDirectory {
  param([Parameter(Mandatory=$true)][string]$CommandLine)

  $patterns = @(
    '(?i)(?:^|\s)"--user-data-dir=([^"]+)"',
    '(?i)(?:^|\s)--user-data-dir="([^"]+)"',
    '(?i)(?:^|\s)--user-data-dir=([^\s"]+)',
    '(?i)(?:^|\s)--user-data-dir\s+"([^"]+)"',
    '(?i)(?:^|\s)--user-data-dir\s+([^\s"]+)'
  )
  foreach ($pattern in $patterns) {
    $match = [System.Text.RegularExpressions.Regex]::Match($CommandLine, $pattern)
    if (-not $match.Success) {
      continue
    }
    try {
      return [System.IO.Path]::GetFullPath($match.Groups[1].Value)
    } catch {
      return $null
    }
  }
  return $null
}

function Get-DedicatedChromeProcesses {
  param([Parameter(Mandatory=$true)][string]$UserDataDir)

  $expected = [System.IO.Path]::GetFullPath($UserDataDir)
  return @(
    Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
      Where-Object {
        if (-not $_.CommandLine) {
          return $false
        }
        $candidate = Get-ChromeUserDataDirectory -CommandLine $_.CommandLine
        return $candidate -and
          [string]::Equals(
            $candidate,
            $expected,
            [System.StringComparison]::OrdinalIgnoreCase
          )
      }
  )
}
`;

const inspectDedicatedChromePowerShell = String.raw`
param(
  [Parameter(Mandatory=$true)][string]$UserDataDir,
  [Parameter(Mandatory=$true)][string]$AutoplayArgument,
  [Parameter(Mandatory=$true)][string]$RemoteDebuggingArgument
)
$ErrorActionPreference = "Stop"
${dedicatedChromeProcessPowerShell}
$processes = @(Get-DedicatedChromeProcesses -UserDataDir $UserDataDir)
$rootProcesses = @(
  $processes |
    Where-Object { -not $_.CommandLine.Contains("--type=") }
)
$autoplayAllowed =
  $rootProcesses.Count -gt 0 -and
  @(
    $rootProcesses |
      Where-Object { -not $_.CommandLine.Contains($AutoplayArgument) }
  ).Count -eq 0
$remoteDebuggingEnabled =
  $rootProcesses.Count -gt 0 -and
  @(
    $rootProcesses |
      Where-Object { -not $_.CommandLine.Contains($RemoteDebuggingArgument) }
  ).Count -eq 0
[pscustomobject]@{
  processCount = $processes.Count
  rootProcessCount = $rootProcesses.Count
  autoplayAllowed = $autoplayAllowed
  remoteDebuggingEnabled = $remoteDebuggingEnabled
} | ConvertTo-Json -Compress
`;

const stopDedicatedChromePowerShell = String.raw`
param([Parameter(Mandatory=$true)][string]$UserDataDir)
$ErrorActionPreference = "Stop"
${dedicatedChromeProcessPowerShell}
$processes = @(Get-DedicatedChromeProcesses -UserDataDir $UserDataDir)
$rootProcessIds = @(
  $processes |
    Where-Object { -not $_.CommandLine.Contains("--type=") } |
    ForEach-Object { $_.ProcessId }
)
foreach ($processId in $rootProcessIds) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
$deadline = [DateTime]::UtcNow.AddSeconds(5)
do {
  $remaining = @(Get-DedicatedChromeProcesses -UserDataDir $UserDataDir)
  if ($remaining.Count -eq 0) {
    exit 0
  }
  foreach ($process in $remaining) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
Write-Error "Dedicated Chrome processes did not exit"
exit 1
`;

function runPowerShell(
  source,
  arguments_,
  {
    spawnSyncImpl = spawnSync,
    systemEnvironment = process.env,
  } = {},
) {
  const result = spawnSyncImpl(
    windowsPowerShellExecutable(systemEnvironment),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `& {${source}\n}`,
      ...arguments_,
    ],
    {
      encoding: "utf8",
      env: subprocessEnvironment(systemEnvironment),
      windowsHide: true,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Failed to manage the dedicated Chrome profile: ${String(result.stderr ?? "").trim()}`,
    );
  }
  return String(result.stdout ?? "").trim();
}

function inspectDedicatedChrome(
  userDataDir,
  {
    spawnSyncImpl = spawnSync,
    systemEnvironment = process.env,
  } = {},
) {
  const output = runPowerShell(
    inspectDedicatedChromePowerShell,
    [
      "-UserDataDir",
      userDataDir,
      "-AutoplayArgument",
      CHROME_AUTOPLAY_ARGUMENT,
      "-RemoteDebuggingArgument",
      CHROME_REMOTE_DEBUGGING_ARGUMENT,
    ],
    { spawnSyncImpl, systemEnvironment },
  );
  let state;
  try {
    state = JSON.parse(output);
  } catch (error) {
    throw new Error("Dedicated Chrome process state was invalid", {
      cause: error,
    });
  }
  if (
    !Number.isSafeInteger(state?.processCount) ||
    state.processCount < 0 ||
    !Number.isSafeInteger(state?.rootProcessCount) ||
    state.rootProcessCount < 0 ||
    state.rootProcessCount > state.processCount ||
    typeof state?.autoplayAllowed !== "boolean" ||
    typeof state?.remoteDebuggingEnabled !== "boolean"
  ) {
    throw new Error("Dedicated Chrome process state was invalid");
  }
  return Object.freeze({
    autoplayAllowed: state.autoplayAllowed,
    processCount: state.processCount,
    remoteDebuggingEnabled: state.remoteDebuggingEnabled,
    rootProcessCount: state.rootProcessCount,
  });
}

function stopDedicatedChrome(
  userDataDir,
  {
    spawnSyncImpl = spawnSync,
    systemEnvironment = process.env,
  } = {},
) {
  runPowerShell(
    stopDedicatedChromePowerShell,
    ["-UserDataDir", userDataDir],
    { spawnSyncImpl, systemEnvironment },
  );
}

module.exports = {
  CHROME_AUTOPLAY_ARGUMENT,
  CHROME_REMOTE_DEBUGGING_ARGUMENT,
  inspectDedicatedChrome,
  inspectDedicatedChromePowerShell,
  isSameOrDescendantPath,
  stopDedicatedChrome,
  stopDedicatedChromePowerShell,
};
