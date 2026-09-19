/**
 * Focus Session - Dynamic Favicon Renderer
 * Draws real-time progress indicators onto an offscreen canvas and updates the browser tab icon.
 */

class FaviconRenderer {
  constructor() {
    this.faviconElement = document.getElementById('favicon-link');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 64;
    this.canvas.height = 64;
    this.ctx = this.canvas.getContext('2d');
    this.lastProgress = -1;
    this.lastMode = '';
  }

  /**
   * Mode color map matching tokens.css definitions
   */
  getColorPalette(mode) {
    switch (mode) {
      case 'shortBreak':
        return { accent: '#34d399', bg: '#06231a' };
      case 'longBreak':
        return { accent: '#a78bfa', bg: '#0f1123' };
      case 'focus':
      default:
        return { accent: '#38bdf8', bg: '#0b0f17' };
    }
  }

  /**
   * Draws a circular progress ring representing the current session
   * @param {number} progress - Decimal from 0.0 to 1.0
   * @param {string} mode - 'focus' | 'shortBreak' | 'longBreak'
   */
  update(progress, mode) {
    // Prevent unnecessary canvas redraws if delta is negligible
    const roundedProgress = Math.round(progress * 100) / 100;
    if (roundedProgress === this.lastProgress && mode === this.lastMode) {
      return;
    }

    this.lastProgress = roundedProgress;
    this.lastMode = mode;

    const { ctx, canvas } = this;
    const { accent, bg } = this.getColorPalette(mode);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 24;
    const lineWidth = 7;

    // Outer circular container
    ctx.beginPath();
    ctx.arc(centerX, centerY, 28, 0, 2 * Math.PI);
    ctx.fillStyle = bg;
    ctx.fill();

    // Background track ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Active progress stroke (clockwise from top)
    if (progress > 0) {
      const startAngle = -0.5 * Math.PI;
      const endAngle = startAngle + 2 * Math.PI * progress;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, endAngle, false);
      ctx.strokeStyle = accent;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Push base64 data to browser tab icon
    if (this.faviconElement) {
      this.faviconElement.href = canvas.toDataURL('image/png');
    }
  }

  /**
   * Resets favicon to static vector SVG default
   */
  reset() {
    this.lastProgress = -1;
    this.lastMode = '';
    if (this.faviconElement) {
      this.faviconElement.href = './icons/favicon.svg';
    }
  }
}

export const dynamicFavicon = new FaviconRenderer();
