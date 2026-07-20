const { execFileSync } = require("node:child_process");

function parseRuntimeVersion(runtimeName) {
  const match = runtimeName.match(/\.iOS-(\d+(?:-\d+)*)$/);
  return match === null
    ? null
    : match[1].split("-").map((part) => Number.parseInt(part, 10));
}

function compareVersionsDescending(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function selectIOS26Simulator(simulatorList) {
  const runtimes = Object.entries(simulatorList.devices ?? {})
    .map(([runtimeName, devices]) => ({
      runtimeName,
      version: parseRuntimeVersion(runtimeName),
      devices,
    }))
    .filter(
      ({ version, devices }) => version?.[0] === 26 && Array.isArray(devices),
    )
    .sort((left, right) =>
      compareVersionsDescending(left.version, right.version),
    );

  for (const runtime of runtimes) {
    const availableIPhones = runtime.devices.filter(
      (device) =>
        device.isAvailable !== false &&
        typeof device.udid === "string" &&
        /^iPhone\b/.test(device.name),
    );
    const selected =
      availableIPhones.find((device) => device.name === "iPhone 17") ??
      availableIPhones.find((device) => /^iPhone 17\b/.test(device.name)) ??
      availableIPhones[0];
    if (selected !== undefined) {
      return selected.udid;
    }
  }

  throw new Error("an available iOS 26 iPhone simulator was not found");
}

function main() {
  if (process.platform !== "darwin") {
    throw new Error("iOS simulator selection requires macOS");
  }
  const simulatorList = JSON.parse(
    execFileSync("xcrun", ["simctl", "list", "devices", "available", "-j"], {
      encoding: "utf8",
    }),
  );
  process.stdout.write(`${selectIOS26Simulator(simulatorList)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { selectIOS26Simulator };
