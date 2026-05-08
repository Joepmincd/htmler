// ── HTML Editor · 当前页面编辑模式 ──
// 通过右键菜单注入，直接在页面上所见即所得编辑

(function () {
  if (window.__htmlEditorActive) return;
  window.__htmlEditorActive = true;

  let activeEl = null, activeImg = null;

  // ── 注入样式 ──
  const style = document.createElement('style');
  style.textContent = `
    #he-toolbar * { box-sizing: border-box; margin: 0; padding: 0; }
    #he-toolbar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: #16213e; border-bottom: 1px solid #e94566;
      padding: 8px 14px; display: flex; align-items: center; gap: 8px;
      box-shadow: 0 2px 18px rgba(0,0,0,0.5); flex-wrap: wrap;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #he-toolbar .he-sep { width: 1px; height: 26px; background: #e9456640; margin: 0 2px; flex-shrink: 0; }
    #he-toolbar .he-btn {
      background: #0f3460; color: #d0d0d0; border: 1px solid #e9456650; padding: 6px 12px;
      border-radius: 6px; cursor: pointer; font-size: 13px; transition: all 0.15s; white-space: nowrap; line-height: 1.3;
    }
    #he-toolbar .he-btn:hover { background: #e94566; border-color: #e94566; color: #fff; }
    #he-toolbar .he-btn.accent { background: #e94566; border-color: #e94566; color: #fff; }
    #he-toolbar .he-btn.accent:hover { background: #c73050; }
    #he-toolbar .he-btn.warn { color: #f39c12; }
    #he-toolbar .he-btn.warn:hover { background: #c0392b; color: #fff; }
    #he-toolbar .he-label { color: #888; font-size: 12px; white-space: nowrap; }
    #he-sz { width: 50px; padding: 5px 6px; background: #0a1628; border: 1px solid #e9456660; color: #d0d0d0; border-radius: 6px; font-size: 13px; text-align: center; }
    #he-status { margin-left: auto; color: #b0b0b0; font-size: 12px; }
    .he-ed-active { outline: 2px solid #0078d4 !important; outline-offset: 1px; }
    .he-img-hover:hover { outline: 2px dashed #e94566 !important; cursor: pointer; }
    #he-overlay { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; display: none; }
    #he-overlay.show { display: block; }
    body.he-editing { margin-top: 48px !important; }
  `;
  document.head.appendChild(style);

  // ── 工具栏 ──
  const toolbar = document.createElement('div');
  toolbar.id = 'he-toolbar';
  toolbar.innerHTML = `
    <button class="he-btn accent" id="he-btn-save">💾 保存页面</button>
    <div class="he-sep"></div>
    <span class="he-label">字号</span>
    <button class="he-btn" id="he-aplus">A+</button>
    <input type="number" id="he-sz" value="16" min="6" max="200">
    <button class="he-btn" id="he-aminus">A−</button>
    <button class="he-btn" id="he-apply">✓ 应用</button>
    <div class="he-sep"></div>
    <button class="he-btn" id="he-add-text">➕ 文字行</button>
    <button class="he-btn" id="he-add-img">🖼 图片行</button>
    <button class="he-btn" id="he-repl-img" style="display:none">🔄 替换图片</button>
    <div class="he-sep"></div>
    <button class="he-btn warn" id="he-del">🗑 删除</button>
    <div class="he-sep"></div>
    <span id="he-status">点击页面元素开始编辑 · 按 Esc 退出</span>
    <button class="he-btn" id="he-exit">✕ 退出</button>
  `;
  document.body.prepend(toolbar);
  document.body.classList.add('he-editing');

  // ── 页面元素交互 ──
  document.addEventListener('mousedown', function (e) {
    if (e.target.closest('#he-toolbar')) return;
    selectEl(e.target);
  }, true);

  document.addEventListener('dblclick', function (e) {
    if (e.target.closest('#he-toolbar')) return;
    const el = e.target;
    if (el.tagName === 'IMG') return;
    makeEditable(el);
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  });

  function selectEl(el) {
    if (el === document.body || el === document.documentElement) return;
    if (activeEl && activeEl !== el) deactivateEl(activeEl);
    activeEl = el;
    activeImg = el.tagName === 'IMG' ? el : null;
    if (el.tagName !== 'IMG') makeEditable(el);
    const sz = Math.round(parseFloat(getComputedStyle(el).fontSize));
    document.getElementById('he-sz').value = sz;
    document.getElementById('he-repl-img').style.display = activeImg ? 'inline-block' : 'none';
  }

  function makeEditable(el) {
    el.contentEditable = 'true';
    el.classList.add('he-ed-active');
  }

  function deactivateEl(el) {
    if (!el) return;
    el.contentEditable = 'false';
    el.classList.remove('he-ed-active');
  }

  function closeActive() {
    deactivateEl(activeEl);
    activeEl = null;
    activeImg = null;
    document.getElementById('he-repl-img').style.display = 'none';
  }

  // ── 字号操作 ──
  function applySize(px) {
    if (!px || px < 1) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && document.body.contains(sel.anchorNode)) {
      document.execCommand('fontSize', false, '7');
      document.querySelectorAll('font[size="7"]').forEach(f => {
        const span = document.createElement('span');
        span.style.fontSize = px + 'px';
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
      });
    } else if (activeEl) {
      activeEl.style.fontSize = px + 'px';
    }
  }

  // ── 新增文字行 ──
  function addTextRow() {
    const p = document.createElement('p');
    p.style.cssText = 'margin:8px 0;padding:4px 0;min-height:1.5em;';
    p.textContent = '双击编辑文字';
    if (activeEl && activeEl.parentNode) {
      activeEl.parentNode.insertBefore(p, activeEl.nextSibling);
    } else {
      document.body.appendChild(p);
    }
    deactivateEl(activeEl);
    activeEl = p;
    activeImg = null;
    makeEditable(p);
    p.focus();
    const range = document.createRange(); range.selectNodeContents(p);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }

  // ── 新增图片行 ──
  function addImageRow() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      const f = input.files[0];
      input.remove();
      if (!f) return;
      const reader = new FileReader();
      reader.onload = function (ev) {
        if (activeImg) {
          activeImg.src = ev.target.result;
          showToast('✅ 图片已替换');
          return;
        }
        const img = document.createElement('img');
        img.src = ev.target.result;
        img.style.cssText = 'max-width:100%;display:block;margin:8px 0;';
        img.classList.add('he-img-hover');
        if (activeEl && activeEl.parentNode) {
          activeEl.parentNode.insertBefore(img, activeEl.nextSibling);
        } else {
          document.body.appendChild(img);
        }
        deactivateEl(activeEl);
        activeEl = img;
        activeImg = img;
        document.getElementById('he-repl-img').style.display = 'inline-block';
        showToast('✅ 图片已插入');
      };
      reader.readAsDataURL(f);
    });
    input.click();
  }

  // ── 替换图片 ──
  function replaceImage() {
    if (!activeImg) return;
    addImageRow();
  }

  // ── 删除元素 ──
  function deleteEl() {
    if (!activeEl || activeEl === document.body || activeEl === document.documentElement) return;
    if (!confirm('确定删除此元素？')) return;
    activeEl.remove();
    activeEl = null;
    activeImg = null;
    document.getElementById('he-repl-img').style.display = 'none';
  }

  // ── 保存页面 ──
  function savePage() {
    // 清理编辑状态
    deactivateEl(activeEl);
    document.querySelectorAll('.he-ed-active').forEach(el => {
      el.contentEditable = 'false';
      el.classList.remove('he-ed-active');
    });
    // 移除编辑器 UI
    toolbar.remove();
    document.body.classList.remove('he-editing');
    document.querySelectorAll('.he-img-hover').forEach(el => el.classList.remove('he-img-hover'));

    // 构建完整 HTML
    const clone = document.documentElement.cloneNode(true);
    // 移除残留的编辑器标记
    clone.querySelectorAll('#he-toolbar, #__he_file_input__').forEach(el => el.remove());
    const html = '<!DOCTYPE html>\n' + clone.outerHTML;

    // 触发下载
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    a.download = document.title || 'edited-page.html';
    a.click();
    URL.revokeObjectURL(a.href);

    // 恢复编辑状态
    document.body.prepend(toolbar);
    document.body.classList.add('he-editing');
    showToast('✅ 页面已下载');
  }

  // ── 退出编辑 ──
  function exit() {
    deactivateEl(activeEl);
    document.querySelectorAll('.he-ed-active').forEach(el => {
      el.contentEditable = 'false';
      el.classList.remove('he-ed-active');
    });
    document.querySelectorAll('.he-img-hover').forEach(el => el.classList.remove('he-img-hover'));
    toolbar.remove();
    document.body.classList.remove('he-editing');
    style.remove();
    window.__htmlEditorActive = false;
    showToast('👋 已退出编辑模式');
  }

  // ── Toast ──
  function showToast(msg) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#16213e;border:1px solid #e94566;color:#e0e0e0;padding:10px 22px;border-radius:8px;font-size:14px;z-index:2147483647;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2200);
  }

  // ── 按钮事件 ──
  document.getElementById('he-btn-save').addEventListener('click', savePage);
  document.getElementById('he-exit').addEventListener('click', exit);
  document.getElementById('he-apply').addEventListener('click', function () {
    applySize(parseInt(document.getElementById('he-sz').value));
  });
  document.getElementById('he-aplus').addEventListener('click', function () {
    const inp = document.getElementById('he-sz');
    const sz = Math.min(200, parseInt(inp.value || 16) + 2);
    inp.value = sz;
    applySize(sz);
  });
  document.getElementById('he-aminus').addEventListener('click', function () {
    const inp = document.getElementById('he-sz');
    const sz = Math.max(6, parseInt(inp.value || 16) - 2);
    inp.value = sz;
    applySize(sz);
  });
  document.getElementById('he-add-text').addEventListener('click', addTextRow);
  document.getElementById('he-add-img').addEventListener('click', addImageRow);
  document.getElementById('he-repl-img').addEventListener('click', replaceImage);
  document.getElementById('he-del').addEventListener('click', deleteEl);

  // ── 快捷键 ──
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeActive(); }
  });

  showToast('🛠 编辑模式已启动 · 点击元素编辑 · 右键菜单退出');
})();
