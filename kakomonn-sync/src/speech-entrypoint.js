import { WorkerEntrypoint } from "cloudflare:workers";
import { issueSpeechTokenForBinding } from "./speech.js";

export class SpeechTokenEntrypoint extends WorkerEntrypoint {
  async issueToken() {
    return issueSpeechTokenForBinding(this.env);
  }
}
