(() => {
  "use strict";

  let phase = "launch";

  function nextQuestionURL() {
    const content = document.querySelector('meta[name="kakomonn-next-question-url"]')?.content ?? "";
    let url;
    try { url = new URL(content); } catch { throw new Error("invalid_url"); }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "chushoks.kakomonn.com" ||
      url.pathname !== "/createques" ||
      url.search !== "" ||
      url.hash !== "#kakomonn-next"
    ) throw new Error("invalid_url");
    return url.href;
  }

  function showBridgeError(error) {
    document.querySelector("#open-error-detail").textContent =
      `context=open-bridge | code=${error?.message ?? "invalid_url"}`;
    document.querySelector("#open-error").showModal();
  }

  window.addEventListener("pageshow", (event) => {
    if (phase === "away") {
      if (event.persisted) location.replace("/");
      return;
    }
    try {
      const target = nextQuestionURL();
      phase = "away";
      history.replaceState(null, "", "/");
      history.pushState(null, "", "/open");
      location.replace(target);
    } catch (error) {
      phase = "error";
      showBridgeError(error);
    }
  });
})();
