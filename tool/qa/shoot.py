"""Screenshot di ogni strumento su viewport da telefono, prima e dopo il caricamento di un PDF."""
import sys, os, json
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8765')
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLE = os.path.join(HERE, 'sample.pdf')
SITE = os.environ.get('SITE', '/home/claude/pdfcrafttool/pdfcraft/out')
tools = sys.argv[2:] or sorted(d for d in os.listdir(f'{SITE}/it/tools') if '.' not in d and d != 'category')

MEASURE = r"""
() => {
  const vw = window.innerWidth;
  const r = { scrollW: document.documentElement.scrollWidth };
  const small = [];
  const iface = document.querySelector('[data-testid="tool-page-interface"]');
  for (const el of (iface || document).querySelectorAll('button, a, input, select, [role=button]')) {
    const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (b.width === 0 || b.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.type === 'file' || el.type === 'hidden') continue;
    if (b.width < 32 || b.height < 32) small.push((el.getAttribute('aria-label') || el.title || el.textContent || el.tagName).trim().slice(0, 25) + ` ${Math.round(b.width)}x${Math.round(b.height)}`);
  }
  r.small = small.length; r.smallEx = small.slice(0, 8);
  const cjk = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) {
    const t = n.textContent.trim(); if (!t || !/[぀-ヿ一-鿿]/.test(t)) continue;
    const el = n.parentElement; if (!el) continue; const b = el.getBoundingClientRect();
    if (b.width === 0 || getComputedStyle(el).visibility === 'hidden') continue;
    if (/^(简体中文|繁體中文|日本語|한국어)$/.test(t)) continue;
    cjk.push(t.slice(0, 40));
  }
  r.cjk = cjk.slice(0, 6);
  const keys = [];
  const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while ((n = w2.nextNode())) { const t = n.textContent.trim(); if (/^(common|tools)\.[A-Za-z]+\.[A-Za-z.]+$/.test(t)) keys.push(t); }
  r.keys = keys.slice(0, 5);
  const wide = [];
  if (iface) {
    const lim = iface.getBoundingClientRect().right + 2;
    for (const el of iface.querySelectorAll('*')) {
      if (el.closest('[data-app-fullscreen]')) continue;
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.right > lim && ![...el.children].some(c => c.getBoundingClientRect().right > lim)) {
        const cls = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
        wide.push(el.tagName.toLowerCase() + '.' + cls.split(/\s+/).slice(0, 4).join('.') + ` w=${Math.round(b.width)} '${(el.textContent||'').trim().slice(0,20)}'`);
      }
    }
  }
  r.wide = wide.slice(0, 5); r.wideN = wide.length;
  return r;
}
"""

report = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='it-IT')
    page = ctx.new_page()
    for t in tools:
        rec = {}
        try:
            page.goto(f'{BASE}/it/tools/{t}/', wait_until='load', timeout=120000)
            page.wait_for_timeout(2000)
            page.screenshot(path=f'{OUT}/{t}-1.png', full_page=True)
            rec['before'] = page.evaluate(MEASURE)
            inp = page.query_selector('input[type=file]')
            if inp:
                accept = (inp.get_attribute('accept') or '').lower()
                rec['accept'] = accept
                if not accept or 'pdf' in accept:
                    inp.set_input_files(SAMPLE)
                    page.wait_for_timeout(3000)
                    page.screenshot(path=f'{OUT}/{t}-2.png', full_page=True)
                    rec['after'] = page.evaluate(MEASURE)
        except Exception as e:
            rec['error'] = str(e)[:200]
        report[t] = rec
        print(t, json.dumps({k: (v if k in ('accept', 'error') else {kk: v.get(kk) for kk in ('scrollW', 'small', 'wideN', 'cjk', 'keys')}) for k, v in rec.items()}, ensure_ascii=False), flush=True)
    b.close()
json.dump(report, open(f'{OUT}/report-{os.getpid()}.json', 'w'), indent=1, ensure_ascii=False)
