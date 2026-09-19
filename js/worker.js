/**
 * Rally - Timing Web Worker
 * Runs countdown and count-up loops on a background thread immune to main-thread throttling.
 */

let timerInterval = null;
let anchorTimestamp = 0;
let direction = 'countdown';

self.onmessage = (event) => {
  const { command, remainingMs, targetTime, timerDirection } = event.data;

  switch (command) {
    case 'START':
      direction = timerDirection || 'countdown';
      clearInterval(timerInterval);

      if (direction === 'countdown') {
        anchorTimestamp = targetTime || (Date.now() + remainingMs);

        timerInterval = setInterval(() => {
          const now = Date.now();
          const currentRemaining = Math.max(0, anchorTimestamp - now);

          self.postMessage({
            type: 'TICK',
            remainingMs: currentRemaining,
          });

          if (currentRemaining <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            self.postMessage({ type: 'COMPLETE' });
          }
        }, 200);
      } else {
        // Count-up / Flow mode
        anchorTimestamp = targetTime || (Date.now() - remainingMs);

        timerInterval = setInterval(() => {
          const now = Date.now();
          const elapsed = Math.max(0, now - anchorTimestamp);

          self.postMessage({
            type: 'TICK',
            remainingMs: elapsed,
          });
        }, 200);
      }
      break;

    case 'PAUSE':
    case 'STOP':
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      break;

    default:
      console.warn(`[Worker] Unrecognized command: ${command}`);
  }
};
