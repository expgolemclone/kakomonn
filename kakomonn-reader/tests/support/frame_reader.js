const READER_SOURCE_URL = "kakomonn-reader.user.js";

async function installReaderInChildFrames(target, script) {
  await target.addInitScript(
    ({ source, sourceURL }) => {
      if (window.top === window.self) {
        return;
      }

      let documentObserver = null;
      const runReader = () => {
        if (
          document.readyState === "loading" ||
          !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kakomonn\.com$/.test(
            location.hostname,
          )
        ) {
          return;
        }
        document.removeEventListener("DOMContentLoaded", runReader);
        window.removeEventListener("load", runReader);
        documentObserver?.disconnect();
        (0, eval)(`${source}\n//# sourceURL=${sourceURL}`);
      };
      document.addEventListener("DOMContentLoaded", runReader);
      window.addEventListener("load", runReader);
      documentObserver = new MutationObserver(runReader);
      documentObserver.observe(document, { childList: true, subtree: true });
      if (document.readyState !== "loading") {
        runReader();
      }
    },
    { source: script, sourceURL: READER_SOURCE_URL },
  );
}

async function dispatchNextQuestionSwipe(frame) {
  return frame.evaluate(() => {
    const target = document.body;
    const startX = innerWidth * 0.75;
    const endX = innerWidth * 0.25;
    const y = innerHeight * 0.5;
    const touch = (clientX) => ({
      clientX,
      clientY: y,
      identifier: 1,
    });
    const createEvent = (type, touches, changedTouches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        changedTouches: { value: changedTouches },
        touches: { value: touches },
      });
      return event;
    };
    const startTouch = touch(startX);
    const endTouch = touch(endX);
    target.dispatchEvent(
      createEvent("touchstart", [startTouch], [startTouch]),
    );
    const endEvent = createEvent("touchend", [], [endTouch]);
    const dispatchResult = target.dispatchEvent(endEvent);
    return {
      dispatchResult,
      endDefaultPrevented: endEvent.defaultPrevented,
    };
  });
}

module.exports = {
  dispatchNextQuestionSwipe,
  installReaderInChildFrames,
};
