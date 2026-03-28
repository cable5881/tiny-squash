export class CompareSlider {
  constructor(container) {
    this.container = container;
    this.sliderPos = 50;
    this.init();
  }

  init() {
    this.container.innerHTML = `
      <div class="compare-wrapper">
        <img class="compare-original" alt="Original preview" />
        <div class="compare-overlay">
          <img class="compare-compressed" alt="Compressed preview" />
        </div>
        <div class="compare-handle" aria-label="Drag to compare" role="separator">
          <div class="handle-circle"></div>
        </div>
      </div>
    `;
    this.bindDragEvents();
  }

  setImages(originalUrl, compressedUrl) {
    this.container.querySelector('.compare-original').src = originalUrl;
    this.container.querySelector('.compare-compressed').src = compressedUrl;
    this.updatePosition(50);
  }

  updatePosition(percent) {
    this.sliderPos = Math.max(0, Math.min(100, percent));
    const overlay = this.container.querySelector('.compare-overlay');
    const handle = this.container.querySelector('.compare-handle');
    overlay.style.width = `${this.sliderPos}%`;
    handle.style.left = `${this.sliderPos}%`;
  }

  bindDragEvents() {
    const handle = this.container.querySelector('.compare-handle');
    let isDragging = false;

    handle.addEventListener('pointerdown', () => {
      isDragging = true;
    });

    document.addEventListener('pointerup', () => {
      isDragging = false;
    });

    this.container.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const rect = this.container.getBoundingClientRect();
      const percent = ((e.clientX - rect.left) / rect.width) * 100;
      this.updatePosition(percent);
    });
  }
}
