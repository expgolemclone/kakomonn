import { startReader } from "./reader-controller.js";
import { installIPhoneRuntimeRecycleGuard } from "./runtime-recycle.js";

installIPhoneRuntimeRecycleGuard();
void startReader();
