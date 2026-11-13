/* 仅操作本地报告 DOM 与原始 patch；不访问业务服务。 */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const announce = text => { byId('interaction-status').textContent = text; };
  byId('wrap-code').addEventListener('change', e => document.body.classList.toggle('wrap-code', e.target.checked));
  ['expand', 'collapse'].forEach(action => byId(`${action}-all`).addEventListener('click', () => {
    document.querySelectorAll('details[data-review-expand]').forEach(d => {
      if (action === 'collapse' || d.closest('.file-item')?.dataset.bucket !== '测试') d.open = action === 'expand';
    });
  }));
  const sizeHeader = target => {
    const relation = target.matches('.change-relation>h3');
    target.closest(relation ? '.change-relation' : '.file-item').style.setProperty(
      relation ? '--relation-header-height' : '--file-header-height', `${target.getBoundingClientRect().height + 18}px`);
  };
  const reveal = hash => {
    let id; try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    const target = byId(id); if (!target) return;
    for (let p = target; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
    // 展开后同步测量，避免后台标签的帧节流让锚点先落在旧布局。
    [target.closest('.change-relation')?.querySelector(':scope>h3'),
     target.closest('.file-item')?.querySelector('.file-summary')].filter(Boolean).forEach(sizeHeader);
    target.scrollIntoView({block:'start',behavior:'instant'});
  };
  window.addEventListener('hashchange', () => reveal(location.hash));
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-open-target]'); if (!a) return;
    e.preventDefault();
    if (location.hash !== a.hash) history.pushState(null, '', a.hash);
    reveal(a.hash);
  });
  if (location.hash) reveal(location.hash);
  const observer = new ResizeObserver(entries => entries.forEach(({target}) => sizeHeader(target)));
  document.querySelectorAll('.change-relation>h3,.file-review>.file-summary,.file-item>div.file-summary').forEach(h => observer.observe(h));
  const raw = button => {
    const data = button.closest('.file-content').querySelector('.raw-patch');
    return {patch:new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(data.dataset.patchBase64), c=>c.charCodeAt(0))),filename:data.dataset.filename};
  };
  document.addEventListener('click', async e => {
    const copy=e.target.closest('[data-copy-patch]'), download=e.target.closest('[data-download-patch]');
    if(!copy && !download) return;
    try {
      const {patch,filename}=raw(copy||download);
      if(copy) { await navigator.clipboard.writeText(patch); announce('已复制完整原始 diff。'); }
      else { const url=URL.createObjectURL(new Blob([patch],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename.replace(/[\\/]/g,'_')+'.diff';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
    } catch { announce('浏览器未允许此操作，请使用另一种本地 diff 导出方式。'); }
  });
})();
