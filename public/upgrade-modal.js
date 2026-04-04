/**
 * 升级提示弹窗组件
 */
export class UpgradeModal {
  constructor() {
    this.overlay = null;
    this._create();
  }

  _create() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'upgrade-overlay hidden';
    this.overlay.innerHTML = `
      <div class="upgrade-modal">
        <button class="upgrade-close" aria-label="关闭">&times;</button>
        <div class="upgrade-icon">🚀</div>
        <h2 class="upgrade-title"></h2>
        <p class="upgrade-desc"></p>
        <div class="upgrade-plans">
          <div class="upgrade-plan">
            <span class="upgrade-plan-price">$4.9<small>/月</small></span>
            <span class="upgrade-plan-label">月付</span>
          </div>
          <div class="upgrade-plan upgrade-plan-featured">
            <span class="upgrade-plan-save">省 40%</span>
            <span class="upgrade-plan-price">$2.9<small>/月</small></span>
            <span class="upgrade-plan-label">年付 $34.9/年</span>
          </div>
        </div>
        <a href="/pricing.html" class="pricing-btn pricing-btn-primary upgrade-cta">查看方案详情</a>
        <p class="upgrade-note">所有方案均支持 7 天无条件退款</p>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.overlay.querySelector('.upgrade-close').addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  show(title, desc) {
    this.overlay.querySelector('.upgrade-title').textContent = title || '升级到 Pro';
    this.overlay.querySelector('.upgrade-desc').textContent = desc || '解锁无限压缩和全部高级功能';
    this.overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  hide() {
    this.overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

// Singleton
let _instance = null;
export function getUpgradeModal() {
  if (!_instance) _instance = new UpgradeModal();
  return _instance;
}
