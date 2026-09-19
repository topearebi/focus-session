/**
 * Focus Session - Dedicated Timing Web Worker
 * Runs countdown intervals on a background thread immune to main-thread throttling.
 */

let timerInterval = null;
let targetTimestamp = 0;

/**
 * Handle command dispatches from the main execution thread
 */
self.onmessage = (event) => {
  const { command, remainingMs, targetTime } = event.data;

  switch (command) {
    case 'START':
      // Prefer explicit targetTime if synchronized; fallback to computing from remainingMs
      targetTimestamp = targetTime || (Date.now() + remainingMs);
      
      clearInterval(timerInterval);

      // High-frequency polling loop (200ms) guarantees sub-second precision
      timerInterval = setInterval(() => {
        const now = Date.now();
        const currentRemaining = Math.max(0, targetTimestamp - now);

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
      break;

    case 'PAUSE':
    case 'STOP':
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      break;

    default:
      console.warn(`[Worker] Unrecognized command received: ${command}`);
  }
};
