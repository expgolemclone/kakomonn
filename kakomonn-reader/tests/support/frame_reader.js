const READER_SOURCE_URL = "kakomonn-reader.user.js";

async function installReaderInChildFrames(target, script) {
  await target.addInitScript(
    ({ source, sourceURL }) => {
      if (
        window.top === window.self ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kakomonn\.com$/.test(
          location.hostname,
        )
      ) {
        return;
      }

      const runReader = () => {
        (0, eval)(`${source}\n//# sourceURL=${sourceURL}`);
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", runReader, {
          once: true,
        });
      } else {
        runReader();
      }
    },
    { source: script, sourceURL: READER_SOURCE_URL },
  );
}

module.exports = { installReaderInChildFrames };
