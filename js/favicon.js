/**
 * Rally - Dynamic Favicon Renderer
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

  getColorPalette(mode) {
    switch (mode) {
      case 'focus':
        return { accent: '#38bdf8', bg: '#080d1a' };
      case 'rest':
        return { accent: '#34d399', bg: '#061812' };
      case 'sprint':
      default:
        return { accent: '#fbbf24', bg: '#0d0f17' };
    }
  }

  /**
   * Renders the circular dial progress to the tab icon
   * @param {number} progress - Decimal from 0.0 to 1.0
   * @param {string} mode - 'sprint' | 'focus' | 'rest'
   */
  update(progress, mode) {
    const rounded = Math.round(progress * 100) / 100;
    if (rounded === this.lastProgress && mode === this.lastMode) {
      return;
    }

    this.lastProgress = rounded;
    this.lastMode = mode;

    const { ctx, canvas } = this;
    const { accent, bg } = this.getColorPalette(mode);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 24;
    const lineWidth = 7;

    // Rounded background tile
    ctx.beginPath();
    ctx.arc(centerX, centerY, 28, 0, 2 * Math.PI);
    ctx.fillStyle = bg;
    ctx.fill();

    // Background track ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Active progress stroke
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

    if (this.faviconElement) {
      this.faviconElement.href = canvas.toDataURL('image/png');
    }
  }

  reset() {
    this.lastProgress = -1;
    this.lastMode = '';
    if (this.faviconElement) {
      this.faviconElement.href = './icons/favicon.svg';
    }
  }
}

export const dynamicFavicon = new FaviconRenderer();
