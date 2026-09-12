import { startReader } from "./reader-controller.js";
import { installIPhoneRuntimeRecycleGuard } from "./runtime-recycle.mjs";

installIPhoneRuntimeRecycleGuard();
void startReader();
