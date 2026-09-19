/**
 * Rally - Precision Background Worker
 * Dedicated off-thread timer loop managing countdown and capped count-up sessions.
 */

let timerId = null;

self.onmessage = (event) => {
  const { command, remainingMs, targetTime, timerDirection, totalDurationMs } = event.data;

  if (command === 'START') {
    clearInterval(timerId);

    timerId = setInterval(() => {
      const now = Date.now();

      if (timerDirection === 'countup') {
        const elapsed = now - targetTime;

        if (totalDurationMs && elapsed >= totalDurationMs) {
          clearInterval(timerId);
          self.postMessage({ type: 'TICK', remainingMs: totalDurationMs });
          self.postMessage({ type: 'COMPLETE' });
        } else {
          self.postMessage({ type: 'TICK', remainingMs: Math.max(0, elapsed) });
        }
      } else {
        const remaining = targetTime - now;

        if (remaining <= 0) {
          clearInterval(timerId);
          self.postMessage({ type: 'TICK', remainingMs: 0 });
          self.postMessage({ type: 'COMPLETE' });
        } else {
          self.postMessage({ type: 'TICK', remainingMs: Math.max(0, remaining) });
        }
      }
    }, 250);
  } else if (command === 'PAUSE') {
    clearInterval(timerId);
    timerId = null;
  }
};
