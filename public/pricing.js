// Pricing page logic
const btnMonthly = document.getElementById('btn-monthly');
const btnYearly = document.getElementById('btn-yearly');
const proPrice = document.getElementById('pro-price');
const proPeriod = document.getElementById('pro-period');
const proAnnualNote = document.getElementById('pro-annual-note');
const btnUpgrade = document.getElementById('btn-upgrade-pro');

let billingCycle = 'monthly';

btnMonthly.addEventListener('click', () => {
  billingCycle = 'monthly';
  btnMonthly.classList.add('active');
  btnYearly.classList.remove('active');
  proPrice.textContent = '$4.9';
  proPeriod.textContent = '/月';
  proAnnualNote.classList.add('hidden');
});

btnYearly.addEventListener('click', () => {
  billingCycle = 'yearly';
  btnYearly.classList.add('active');
  btnMonthly.classList.remove('active');
  proPrice.textContent = '$2.9';
  proPeriod.textContent = '/月';
  proAnnualNote.classList.remove('hidden');
});

btnUpgrade.addEventListener('click', async () => {
  // Check login status first
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await res.json();
    if (!data.authenticated) {
      // Redirect to login
      window.location.href = '/api/auth/google/login';
      return;
    }
    if (data.plan === 'pro') {
      alert('你已经是 Pro 用户了！');
      return;
    }
    // TODO: integrate actual payment (Stripe/LemonSqueezy)
    alert('支付功能即将上线，敬请期待！\n\nPayment integration coming soon.');
  } catch (err) {
    alert('网络错误，请稍后重试');
  }
});
