/**
 * Waits for `stopping` for at most `timeoutMs`. Resolves "stopped" when it
 * finishes in time and "timed-out" when it does not; rejects when it fails in
 * time. A stop that settles after the limit is ignored.
 */
function stopWithin(stopping, timeoutMs) {
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), timeoutMs);
  });

  return Promise.race([stopping.then(() => "stopped"), timedOut]).finally(() =>
    clearTimeout(timer),
  );
}

module.exports = {
  stopWithin,
};
