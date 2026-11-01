import React from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Alert, Badge, Box, Button, Center, Code, Loader, MantineProvider, Modal, Paper, Progress, Stack, Text, TextInput, Title } from "@mantine/core";

export function installViewController(app) {
  const shell = document.createElement("div");
  shell.id = "kakomonn-reader-shell";
  shell.dataset.buildFingerprint = app.BUILD_FINGERPRINT;
  shell.dataset.scriptHandler = app.SCRIPT_HANDLER;

  const frame = document.createElement("iframe");
  frame.id = "kakomonn-reader-frame";
  frame.title = "過去問ページ";
  frame.allow = "autoplay";
  frame.src = app.currentFrameURL;
  function enforceReaderFrameDimensions() {
    frame.removeAttribute("height");
    frame.removeAttribute("width");
    if (frame.style.getPropertyValue("height") !== "100%" || frame.style.getPropertyPriority("height") !== "important") {
      frame.style.setProperty("height", "100%", "important");
    }
    if (frame.style.getPropertyValue("width") !== "100%" || frame.style.getPropertyPriority("width") !== "important") {
      frame.style.setProperty("width", "100%", "important");
    }
  }
  enforceReaderFrameDimensions();
  const readerFrameDimensionObserver = new MutationObserver(enforceReaderFrameDimensions);
  readerFrameDimensionObserver.observe(frame, { attributes: true, attributeFilter: ["height", "style", "width"] });
  shell.appendChild(frame);

  const host = document.createElement("div");
  const root = createRoot(host);
  const view = {
    mode: "reader",
    launcher: null,
    progress: { visible: false, value: app.TIME_LIMIT_MS, phase: null, label: "" },
    studyTime: { compact: "0m", label: "今日の勉強時間 0分" },
    feedback: null,
  };
  const syncSettings = { open: false, draft: "", error: "", disabled: false };
  const errorDialog = { open: false, title: "", message: "", detail: "", retryLabel: "", retryDisabled: false };
  let visibleReaderErrorSignature = "";
  let readerErrorRetryAction = null;

  function UI() {
    return <MantineProvider forceColorScheme="dark" withCssVariables={false} withGlobalClasses={false}>
      {view.mode === "launcher" && <Center component="main" id="kakomonn-next-question-launcher" aria-labelledby="kakomonn-next-question-title">
        <Paper id="kakomonn-next-question-panel" data-state={view.launcher.state}
          aria-busy={view.launcher.state === "loading"} p="xl" withBorder radius="lg">
          <Stack>
            <Text fw={700} c="dimmed" size="xs">KAKOMONN</Text>
            {view.launcher.state === "loading" && <Loader aria-hidden="true" />}
            <Title id="kakomonn-next-question-title" order={1}>{view.launcher.title}</Title>
            <Text id="next-question-status" role={view.launcher.state === "service-error" ? "alert" : "status"}
              aria-live="polite">{view.launcher.message}</Text>
            {view.launcher.showRetry && <Button id="next-question-retry" size="lg"
              onClick={() => void app.startNextQuestionLauncher()}>もう一度試す</Button>}
          </Stack>
        </Paper>
      </Center>}
      {createPortal(<>
        {view.progress.visible && <Progress.Root id="kakomonn-reader-time-limit" data-phase={view.progress.phase}
          role="progressbar" aria-label="問題の制限時間" aria-valuemin={0} aria-valuemax={app.TIME_LIMIT_MS}
          aria-valuenow={view.progress.value} aria-valuetext={view.progress.label}>
          <Progress.Section value={100 * view.progress.value / app.TIME_LIMIT_MS} withAria={false}
            color={view.progress.phase === "explanation" ? "green" : "blue"} />
        </Progress.Root>}
        <Badge id="kakomonn-reader-study-time" role="status" aria-live="off"
          aria-label={view.studyTime.label} title={view.studyTime.label}>{view.studyTime.compact}</Badge>
        {view.feedback && <Alert id="kakomonn-reader-feedback" color="green" aria-hidden="true"
          data-rarity={view.feedback.id}>
          <Text id="kakomonn-reader-feedback-rarity" fw={700}>{view.feedback.label}</Text>
          <Text id="kakomonn-reader-feedback-message" fw={700}>{view.feedback.displayText}</Text>
        </Alert>}
      </>, shell)}
      <Modal.Root opened={syncSettings.open} onClose={() => {}} closeOnEscape={false}
        closeOnClickOutside={false} lockScroll={false} withinPortal={false} centered transitionProps={{ duration: 0 }}>
        <Modal.Overlay />
        <Modal.Content id="kakomonn-reader-sync-settings">
          <Modal.Header><Modal.Title>学習記録へ接続</Modal.Title></Modal.Header>
          <Modal.Body>
            <Box component="form" onSubmit={(event) => { event.preventDefault(); void app.saveSyncSettings(); }}>
              <Stack>
                <Text>Win11とiPhoneに同じ同期トークンを入力してください.</Text>
                <TextInput id="kakomonn-reader-sync-token" type="password" size="lg" label="同期トークン"
                  autoComplete="off" spellCheck={false} required data-autofocus
                  value={syncSettings.draft} disabled={syncSettings.disabled}
                  onChange={(event) => setSyncSettings({ draft: event.currentTarget.value })} />
                <Text id="kakomonn-reader-sync-settings-error" role="alert" c="red">{syncSettings.error}</Text>
                <Button id="kakomonn-reader-sync-settings-save" type="submit" size="lg" disabled={syncSettings.disabled}>確認して保存</Button>
              </Stack>
            </Box>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
      <Modal.Root opened={errorDialog.open} onClose={closeReaderError} lockScroll={false} withinPortal={false}
        centered transitionProps={{ duration: 0 }}>
        <Modal.Overlay />
        <Modal.Content id="kakomonn-reader-error-dialog">
          <Modal.Header><Modal.Title id="kakomonn-reader-error-title">{errorDialog.title}</Modal.Title></Modal.Header>
          <Modal.Body><Stack>
            <Text id="kakomonn-reader-error-message">{errorDialog.message}</Text>
            <Code id="kakomonn-reader-error-detail">{errorDialog.detail}</Code>
            {readerErrorRetryAction && <Button id="kakomonn-reader-error-retry" size="lg"
              disabled={errorDialog.retryDisabled} onClick={() => void retryReaderError()}>{errorDialog.retryLabel}</Button>}
            <Button id="kakomonn-reader-error-close" size="lg" data-autofocus onClick={closeReaderError}>閉じる</Button>
          </Stack></Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </MantineProvider>;
  }

  function render() { flushSync(() => root.render(<UI />)); }
  function setSyncSettings(patch) {
    const previous = syncSettings.open;
    Object.assign(syncSettings, patch);
    render();
    if (previous !== syncSettings.open) app.handleDialogStateChange?.();
  }
  function setErrorDialog(patch) {
    const previous = errorDialog.open;
    Object.assign(errorDialog, patch);
    render();
    if (previous !== errorDialog.open) app.handleDialogStateChange?.();
  }
  function closeReaderError() {
    visibleReaderErrorSignature = "";
    readerErrorRetryAction = null;
    setErrorDialog({ open: false, retryDisabled: false });
  }
  async function retryReaderError() {
    if (readerErrorRetryAction === null || errorDialog.retryDisabled) return;
    const retryAction = readerErrorRetryAction;
    setErrorDialog({ retryDisabled: true });
    try {
      if (await retryAction() && errorDialog.open) closeReaderError();
    } finally {
      if (errorDialog.open) setErrorDialog({ retryDisabled: false });
    }
  }
  function readerErrorDetail(error, context) {
    const details = [`context=${context}`];
    if (typeof error?.code === "string" && error.code !== "") details.push(`code=${error.code}`);
    if (Number.isSafeInteger(error?.status) && error.status > 0) details.push(`status=${error.status}`);
    if (typeof error?.message === "string" && error.message !== "" && error.message !== error.code) {
      details.push(`detail=${error.message}`);
    }
    return details.join(" | ");
  }
  function showReaderError(context, title, message, error = null, retryAction = null) {
    const detail = readerErrorDetail(error, context);
    const retryLabel = retryAction?.label ?? "";
    const signature = `${title}\u0000${message}\u0000${detail}\u0000${retryLabel}`;
    if (errorDialog.open && signature === visibleReaderErrorSignature) return;
    readerErrorRetryAction = retryAction?.run ?? null;
    visibleReaderErrorSignature = signature;
    setErrorDialog({ title, message, detail, retryLabel, retryDisabled: false,
      open: syncSettings.open ? false : true });
  }
  function mountReaderUI() {
    document.body.dataset.kakomonnReaderUi = "true";
    view.mode = "reader";
    if (!shell.isConnected || !host.isConnected) document.body.replaceChildren(shell, host);
    render();
  }
  function showLauncher(launcher) {
    document.title = "次の問題へ | KAKOMONN";
    delete document.body.dataset.kakomonnReaderUi;
    view.mode = "launcher";
    view.launcher = launcher;
    if (!host.isConnected || shell.isConnected) document.body.replaceChildren(host);
    render();
  }
  function setTimeLimitProgress(patch) {
    Object.assign(view.progress, patch);
    render();
  }
  function setStudyTimeBadge(compact, label) {
    view.studyTime = { compact, label };
    render();
  }
  function clearCorrectFeedbackRemovalTimer() {
    if (app.correctFeedbackRemovalTimer === null) return;
    window.clearTimeout(app.correctFeedbackRemovalTimer);
    app.correctFeedbackRemovalTimer = null;
  }
  function showCorrectFeedbackVisual(variant) {
    clearCorrectFeedbackRemovalTimer();
    view.feedback = variant;
    render();
    return true;
  }
  function completeCorrectFeedbackVisual() {
    if (view.feedback === null) return Promise.resolve();
    clearCorrectFeedbackRemovalTimer();
    return new Promise((resolve) => {
      app.correctFeedbackRemovalTimer = window.setTimeout(() => {
        app.correctFeedbackRemovalTimer = null;
        view.feedback = null;
        render();
        resolve();
      }, app.CORRECT_FEEDBACK_LEAVE_DURATION_MS);
    });
  }

  Object.assign(app, {
    shell, frame, syncSettings, errorDialog, readerErrorDetail, showReaderError,
    closeReaderError, setSyncSettings, mountReaderUI, showLauncher, setTimeLimitProgress,
    setStudyTimeBadge, showCorrectFeedbackVisual, completeCorrectFeedbackVisual,
  });
  render();
}
