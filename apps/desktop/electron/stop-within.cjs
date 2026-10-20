/**
 * Waits for `stopping` for at most `timeoutMs`, and never rejects. Resolves
 * "stopped" when it finishes in time, "failed" when it rejects in time, and
 * "timed-out" otherwise. A stop that settles after the limit is ignored.
 */
function stopWithin(stopping, timeoutMs) {
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), timeoutMs);
  });

  return Promise.race([
    stopping.then(
      () => "stopped",
      () => "failed",
    ),
    timedOut,
  ]).finally(() => clearTimeout(timer));
}

module.exports = {
  stopWithin,
};
