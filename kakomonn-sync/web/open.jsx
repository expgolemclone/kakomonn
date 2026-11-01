import React from "react";
import { createRoot } from "react-dom/client";
import { Button, Center, Code, Group, MantineProvider, Modal, Paper, Stack, Text, Title } from "@mantine/core";
import "@mantine/core/styles.css";
import "./styles.css";
import { scheduledQuestionId } from "../../contracts/kakomonn.mjs";

const READER_READY_TIMEOUT_MS = 15_000;
const READER_BRIDGE_STATE_ATTRIBUTE = "data-kakomonn-reader-bridge-state";
const READER_BRIDGE_TARGET_ATTRIBUTE = "data-kakomonn-reader-bridge-target";
const root = createRoot(document.getElementById("root"));
let phase = "waiting";
let stateObserver = null;
let timeoutID = null;

function render(error = null) {
  root.render(
    <MantineProvider forceColorScheme="dark" withCssVariables={false} withGlobalClasses={false}>
      {!error && (
        <Center component="main" id="open-bridge" className="open-bridge" aria-labelledby="open-status-title">
          <Paper className="open-panel" p="xl" radius="lg" withBorder>
            <Stack>
              <Text c="dimmed" size="xs" fw={700}>KAKOMONN</Text>
              <Title order={1} id="open-status-title">Readerを準備しています</Title>
              <Text id="open-status-message" role="status" aria-live="polite">
                準備が完了すると, 次の問題へ移動します.
              </Text>
            </Stack>
          </Paper>
        </Center>
      )}
      <Modal
        opened={error !== null}
        onClose={() => {}}
        title={<Text span id="open-error-title">{error?.title}</Text>}
        closeOnEscape={false}
        closeOnClickOutside={false}
        withCloseButton={false}
        lockScroll={false}
        centered
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          <Text id="open-error-message">{error?.message}</Text>
          <Code id="open-error-detail">context=open-bridge | code={error?.code}</Code>
          <Group>
            <Button id="open-error-reload" size="lg" onClick={() => location.reload()}>再読み込み</Button>
            <Button component="a" href="/" size="lg" variant="subtle">dashboardへ戻る</Button>
          </Group>
        </Stack>
      </Modal>
    </MantineProvider>,
  );
}

function nextQuestionURL(content) {
  let url;
  try {
    url = new URL(content);
  } catch {
    throw new Error("invalid_url");
  }
  if (scheduledQuestionId(url.href, "chushoks.kakomonn.com") === null) {
    throw new Error("invalid_url");
  }
  return url.href;
}

function stopWaiting() {
  stateObserver?.disconnect();
  stateObserver = null;
  if (timeoutID !== null) clearTimeout(timeoutID);
  timeoutID = null;
}

function showBridgeError(code, title, message) {
  stopWaiting();
  phase = "error";
  render({ code, title, message });
}

function launch(target) {
  stopWaiting();
  phase = "away";
  history.replaceState(null, "", "/");
  history.pushState(null, "", "/open");
  location.replace(target);
}

function handleReaderState() {
  const state = document.documentElement.getAttribute(READER_BRIDGE_STATE_ATTRIBUTE);
  if (state === "ready") {
    try {
      const readerTarget = document.documentElement.getAttribute(READER_BRIDGE_TARGET_ATTRIBUTE);
      launch(nextQuestionURL(readerTarget));
    } catch {
      showBridgeError("invalid_url", "次の問題を開けません", "接続先の設定が不正です.");
    }
    return;
  }
  if (state === "error") {
    showBridgeError(
      "reader_unavailable",
      "Readerを起動できません",
      "Tampermonkeyと過去問readerが有効か確認して, ページを再読み込みしてください.",
    );
  } else if (state === "empty") {
    showBridgeError(
      "no_next_question",
      "今解く問題はありません",
      "時間を置いてから, もう一度確認してください.",
    );
  } else if (state === "unauthorized") {
    showBridgeError(
      "sync_unauthorized",
      "同期tokenを確認してください",
      "問題画面の同期設定でtokenを確認してから, ページを再読み込みしてください.",
    );
  }
}

function waitForReader() {
  stateObserver = new MutationObserver(handleReaderState);
  stateObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [READER_BRIDGE_STATE_ATTRIBUTE],
  });
  timeoutID = setTimeout(() => {
    showBridgeError(
      "reader_ready_timeout",
      "Readerを起動できません",
      "Tampermonkeyと過去問readerが有効か確認して, ページを再読み込みしてください.",
    );
  }, READER_READY_TIMEOUT_MS);
  handleReaderState();
}

window.addEventListener("pageshow", (event) => {
  if (phase === "away") {
    if (event.persisted) location.replace("/");
    return;
  }
  if (phase !== "waiting" || stateObserver) return;
  waitForReader();
});

render();
