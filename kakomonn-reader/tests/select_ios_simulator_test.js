const assert = require("node:assert/strict");

const { selectIOS26Simulator } = require("./select_ios_simulator");

const selected = selectIOS26Simulator({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
      { name: "iPhone 17", udid: "older-runtime", isAvailable: true },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-26-4": [
      { name: "iPhone 17 Pro", udid: "latest-pro", isAvailable: true },
      { name: "iPhone 17", udid: "latest-standard", isAvailable: true },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
      { name: "iPhone 18", udid: "wrong-major", isAvailable: true },
    ],
  },
});
assert.equal(selected, "latest-standard");

assert.throws(
  () =>
    selectIOS26Simulator({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-4": [
          { name: "iPad Pro", udid: "ipad", isAvailable: true },
        ],
      },
    }),
  /iOS 26 iPhone simulator was not found/,
);

console.log("iOS simulator selector test passed");
