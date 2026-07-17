const SYNC_TOKEN_KEY = "kakomonn-reader.sync-token";
const PENDING_CORRECT_KEY = "kakomonn-reader.pending-correct";
const PENDING_CELEBRATION_KEY = "kakomonn-reader.pending-celebration";
const SYNC_API_ORIGIN =
  "https://kakomonn-count-sync.expgolem-lab.workers.dev";
const CONGRATULATIONS_ORIGIN =
  "https://kakomonn-congratulations.expgolem-lab.workers.dev";

async function installSyncMock(
  page,
  {
    count = 0,
    date = "2026-07-17",
    token = "test-sync-token",
    configured = true,
    pendingCorrect = null,
    pendingCelebration = null,
    processedOperations = [],
    userscriptsPromise = false,
  } = {},
) {
  await page.evaluate(
    ({
      initialCount,
      initialDate,
      expectedToken,
      hasStoredToken,
      initialPendingCorrect,
      initialPendingCelebration,
      initialProcessedOperations,
      returnsPromise,
      tokenKey,
      pendingKey,
      celebrationKey,
      expectedOrigin,
    }) => {
      const values = new Map();
      if (hasStoredToken) {
        values.set(tokenKey, expectedToken);
      }
      if (initialPendingCorrect !== null) {
        values.set(pendingKey, initialPendingCorrect);
      }
      if (initialPendingCelebration !== null) {
        values.set(celebrationKey, initialPendingCelebration);
      }

      const processedOperationResults = new Map(
        initialProcessedOperations.map(({ operationId, resultingCount }) => [
          operationId,
          resultingCount,
        ])
      );
      const mock = {
        count: initialCount,
        date: initialDate,
        token: expectedToken,
        calls: [],
        failNextRequest: false,
        failNextSetValue: false,
        failNextDeleteValue: false,
        holdNextSetValue: false,
        releaseHeldSetValue: null,
        commitThenFailNextCorrect: false,
        holdNextRequest: false,
        releaseHeldRequest: null,
      };

      window.__syncMock = mock;
      window.GM = {
        async getValue(key, defaultValue) {
          return values.has(key) ? values.get(key) : defaultValue;
        },
        async setValue(key, value) {
          if (mock.failNextSetValue) {
            mock.failNextSetValue = false;
            throw new Error("mock storage write failed");
          }
          if (mock.holdNextSetValue) {
            mock.holdNextSetValue = false;
            await new Promise((resolve) => {
              mock.releaseHeldSetValue = () => {
                mock.releaseHeldSetValue = null;
                resolve();
              };
            });
          }
          values.set(key, structuredClone(value));
        },
        async deleteValue(key) {
          if (mock.failNextDeleteValue) {
            mock.failNextDeleteValue = false;
            throw new Error("mock storage delete failed");
          }
          values.delete(key);
        },
        xmlHttpRequest(details) {
          let resolveRequest = null;
          let rejectRequest = null;
          const requestPromise = returnsPromise
            ? new Promise((resolve, reject) => {
                resolveRequest = resolve;
                rejectRequest = reject;
              })
            : null;
          const respond = (status, body) => {
            window.setTimeout(() => {
              const response = {
                status,
                responseText: JSON.stringify(body),
              };
              details.onload?.(response);
              resolveRequest?.(response);
            }, 0);
          };
          const failRequest = () => {
            const error = new Error("mock request failed");
            details.onerror?.({});
            rejectRequest?.(error);
          };
          const call = {
            method: details.method,
            url: details.url,
            authorization: details.headers?.Authorization ?? "",
            body: details.data === undefined ? null : JSON.parse(details.data),
          };
          mock.calls.push(call);

          const executeRequest = () => {
            if (mock.failNextRequest) {
              mock.failNextRequest = false;
              failRequest();
              return;
            }

            if (call.authorization !== `Bearer ${mock.token}`) {
              respond(401, { error: "unauthorized" });
              return;
            }

            const requestURL = new URL(call.url);
            if (requestURL.origin !== expectedOrigin) {
              respond(404, { error: "unexpected_origin" });
              return;
            }

            const pathname = requestURL.pathname;
            if (call.method === "GET" && pathname === "/v1/count") {
              respond(200, {
                date: mock.date,
                count: mock.count,
                milestoneInterval: 50,
              });
              return;
            }

            if (call.method === "POST" && pathname === "/v1/correct") {
              if (call.body?.date !== mock.date) {
                respond(409, {
                  error: "date_changed",
                  state: {
                    date: mock.date,
                    count: mock.count,
                    milestoneInterval: 50,
                  },
                });
                return;
              }

              const operationId = call.body?.operationId;
              if (!/^[0-9a-f]{32}$/.test(operationId)) {
                respond(400, { error: "invalid_request" });
                return;
              }
              let resultingCount = processedOperationResults.get(operationId);
              if (resultingCount === undefined) {
                mock.count += 1;
                resultingCount = mock.count;
                processedOperationResults.set(operationId, resultingCount);
              }

              if (mock.commitThenFailNextCorrect) {
                mock.commitThenFailNextCorrect = false;
                failRequest();
                return;
              }

              respond(200, {
                state: {
                  date: mock.date,
                  count: mock.count,
                  milestoneInterval: 50,
                },
                completedMilestone:
                  resultingCount > 0 && resultingCount % 50 === 0
                    ? resultingCount
                    : null,
              });
              return;
            }

            respond(404, { error: "not_found" });
          };

          if (mock.holdNextRequest) {
            mock.holdNextRequest = false;
            mock.releaseHeldRequest = () => {
              mock.releaseHeldRequest = null;
              window.setTimeout(executeRequest, 0);
            };
          } else {
            window.setTimeout(executeRequest, 0);
          }

          if (requestPromise !== null) {
            requestPromise.abort = () => {};
            return requestPromise;
          }
          return { abort() {} };
        },
      };
      window.__getGMValue = (key) =>
        values.has(key) ? structuredClone(values.get(key)) : null;
    },
    {
      initialCount: count,
      initialDate: date,
      expectedToken: token,
      hasStoredToken: configured,
      initialPendingCorrect: pendingCorrect,
      initialPendingCelebration: pendingCelebration,
      initialProcessedOperations: processedOperations,
      returnsPromise: userscriptsPromise,
      tokenKey: SYNC_TOKEN_KEY,
      pendingKey: PENDING_CORRECT_KEY,
      celebrationKey: PENDING_CELEBRATION_KEY,
      expectedOrigin: SYNC_API_ORIGIN,
    },
  );
}

module.exports = {
  installSyncMock,
  CONGRATULATIONS_ORIGIN,
  PENDING_CELEBRATION_KEY,
  PENDING_CORRECT_KEY,
  SYNC_API_ORIGIN,
  SYNC_TOKEN_KEY,
};
