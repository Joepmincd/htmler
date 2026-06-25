// ── 状态 ──
let nextTabId = 0, tabs = [], currentTabId = null;
let editMode = false;
let activeEl = null, activeImg = null;
let iframeMutObs = null, iframeLoadQueue = [];
const SUPPORTED_EXT_RE = /\.(html?|jsx|tsx)$/i;

const previewFrame = document.getElementById('preview-frame');
const emptyState   = document.getElementById('empty-state');
const fbar         = document.getElementById('fbar');
const fileNameEl   = document.getElementById('file-name');
const unsavedEl    = document.getElementById('unsaved');
const tabBar       = document.getElementById('tab-bar');
const tabCnt       = document.getElementById('tab-container');
const btnMode      = document.getElementById('btn-mode');
const btnSave      = document.getElementById('btn-save');

// ── iframe load 队列 ──
previewFrame.addEventListener('load', () => {
  const q = iframeLoadQueue; iframeLoadQueue = [];
  q.forEach(cb => cb());
});

function whenIframeReady(cb) {
  const doc = previewFrame.contentDocument;
  if (doc && doc.readyState === 'complete' && doc.body) {
    cb();
  } else {
    iframeLoadQueue.push(cb);
  }
}

// ── Tab 管理 ──
function getTab() { return tabs.find(t => t.id === currentTabId); }
function getIframeDoc() { return previewFrame.contentDocument; }
function detectKind(name) {
  if (/\.tsx$/i.test(name||'')) return 'tsx';
  if (/\.jsx$/i.test(name||'')) return 'jsx';
  return 'html';
}
function isJSXKind(kind) { return kind === 'jsx' || kind === 'tsx'; }
function displayKind(t) { return isJSXKind(t?.kind) ? ' · ' + String(t.kind).toUpperCase() + ' 源码回写' : ''; }
function assetURL(path) { return new URL(path, document.baseURI).href; }

function showHomeState() {
  closeActive();
  if (iframeMutObs) { iframeMutObs.disconnect(); iframeMutObs = null; }
  previewFrame.style.display = 'none';
  previewFrame.removeAttribute('src');
  document.getElementById('preview').style.display = 'none';
  emptyState.style.display = 'flex';
  fileNameEl.textContent = '未打开文件';
  btnSave.disabled = true;
  unsavedEl.classList.remove('show');
  btnMode.disabled = true;
  updateModeButton();
  refreshDownloads();
}

function saveCurrentTabState() {
  const t = getTab(); if (!t || t.isBlank) return;
  const doc = getIframeDoc();
  if (doc && doc.body && !isJSXKind(t.kind)) {
    t.sourceHTML = cleanHTMLSnapshot(doc);
  }
  t.unsaved = unsavedEl.classList.contains('show');
}

function switchTab(tabId) {
  if (currentTabId === tabId) return;
  closeActive();
  if (iframeMutObs) { iframeMutObs.disconnect(); iframeMutObs = null; }
  saveCurrentTabState();
  currentTabId = tabId;
  const t = tabs.find(x => x.id === tabId);
  if (t) {
    if (t.isBlank) {
      showHomeState();
    } else {
      fileNameEl.textContent = (t.name || 'untitled.html') + displayKind(t);
      btnSave.disabled = false;
      btnMode.disabled = false;
      unsavedEl.classList.toggle('show', !!t.unsaved);
      loadIframeContent(t);
    }
  }
  renderTabs();
}

function closeTab(tabId) {
  const t = tabs.find(x => x.id === tabId);
  if (!t) return;
  if (t.unsaved && !confirm(`「${t.name}」有未保存更改，确定关闭？`)) return;
  if (t._blobUrl) { URL.revokeObjectURL(t._blobUrl); t._blobUrl = null; }
  const idx = tabs.indexOf(t); tabs.splice(idx, 1);
  if (currentTabId === tabId) {
    closeActive();
    if (iframeMutObs) { iframeMutObs.disconnect(); iframeMutObs = null; }
    if (tabs.length > 0) switchTab(tabs[Math.min(idx, tabs.length - 1)].id);
    else {
      currentTabId = null;
      showHomeState();
    }
  }
  renderTabs();
}

function renderTabs() {
  tabCnt.innerHTML = '';
  tabs.forEach(t => {
    const d = document.createElement('div');
    d.className = 'tab' + (t.id === currentTabId ? ' active' : '');
    d.innerHTML = `<span class="tab-dot${t.unsaved?' show':''}"></span><span class="tab-name">${esc(t.name||'untitled')}</span><span class="tab-close">✕</span>`;
    d.addEventListener('click', e => { if (!e.target.classList.contains('tab-close')) switchTab(t.id); });
    d.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); closeTab(t.id); });
    tabCnt.appendChild(d);
  });
  tabBar.classList.toggle('show', tabs.length > 0);
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function createTab(name, fHandle, sourceHTML, styleTags, bodyHTML, kind, filePath) {
  kind = kind || detectKind(name);
  const source = sourceHTML || '';
  const tab = { id: ++nextTabId, name, fHandle, filePath: filePath || '', kind, sourceHTML: source, originalSource: source, workingSource: source, styleTags: styleTags||'', previewBody: bodyHTML||'', unsaved: false, jsxMeta: null };
  tabs.push(tab); switchTab(tab.id);
}

function createBlankTab() {
  const html = '<!DOCTYPE html>\n<html lang="zh">\n<head>\n<meta charset="UTF-8">\n</head>\n<body>\n</body>\n</html>';
  const tab = { id: ++nextTabId, name: '空白页', fHandle: null, filePath: '', kind: 'html', sourceHTML: html, originalSource: html, workingSource: html, styleTags: '', previewBody: '', unsaved: false, jsxMeta: null };
  tabs.push(tab);
  switchTab(tab.id);
  renderTabs();
}

// ── iframe 内容加载 ──
function loadIframeContent(t) {
  const html = isJSXKind(t.kind) ? buildJSXPreviewHTML(t) : (t.sourceHTML || buildHTMLFromParts(t));
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  if (t._blobUrl) URL.revokeObjectURL(t._blobUrl);
  t._blobUrl = URL.createObjectURL(blob);

  previewFrame.style.display = 'block';
  emptyState.style.display = 'none';
  document.getElementById('preview').style.display = 'none';
  hideFbar();
  closeActive();
  if (iframeMutObs) { iframeMutObs.disconnect(); iframeMutObs = null; }

  previewFrame.src = t._blobUrl;

  if (editMode) {
    whenIframeReady(() => {
      const doc = getIframeDoc();
      if (doc) injectEditing(doc);
    });
  }
}

function buildHTMLFromParts(t) {
  return `<!DOCTYPE html>\n<html lang="zh">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n${t.styleTags||''}\n</head>\n<body>\n${t.previewBody||''}\n</body>\n</html>`;
}

// ── JSX / TSX 渲染与有限源码回写 ──
function ensureBabel() {
  if (!window.Babel) throw new Error('Babel 运行时未加载');
  if (!Babel.packages || !Babel.packages.parser || !Babel.packages.traverse || !Babel.packages.generator || !Babel.packages.types) {
    throw new Error('Babel standalone 缺少 AST 工具');
  }
  return Babel.packages;
}
function parserPlugins(kind) { return kind === 'tsx' ? ['jsx', 'typescript', 'classProperties'] : ['jsx', 'classProperties']; }
function parseSource(source, kind) { return ensureBabel().parser.parse(source, { sourceType: 'module', plugins: parserPlugins(kind) }); }
function jsxNameToString(name) {
  if (!name) return '';
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') return jsxNameToString(name.object) + '.' + jsxNameToString(name.property);
  return '';
}
function isHostJSXName(name) { const n = jsxNameToString(name); return !!n && n[0] === n[0].toLowerCase(); }
function isSameJSXName(a, b) { return jsxNameToString(a).toLowerCase() === String(b||'').toLowerCase(); }
function getAttr(node, name) { return (node.openingElement.attributes || []).find(a => a.type === 'JSXAttribute' && a.name?.name === name); }
function setStringAttr(node, name, value) {
  const { types: t } = ensureBabel();
  let attr = getAttr(node, name);
  if (!attr) { node.openingElement.attributes.push(t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value))); return; }
  attr.value = t.stringLiteral(value);
}
function attrStaticString(node, name) { const a = getAttr(node, name); return !!(a && a.value && a.value.type === 'StringLiteral'); }
function hasSpreadAttrs(node) { return (node.openingElement.attributes || []).some(a => a.type === 'JSXSpreadAttribute'); }
function nonBlankChildren(node) { return (node.children || []).filter(c => !(c.type === 'JSXText' && !c.value.trim())); }
function isTextOnlyElement(node) { const kids = nonBlankChildren(node); return kids.length === 1 && kids[0].type === 'JSXText'; }
function isStaticContainer(node) { return !hasSpreadAttrs(node) && (node.children || []).every(c => c.type === 'JSXText' || (c.type === 'JSXElement' && isHostJSXName(c.openingElement.name))); }
function makeJsxMeta(source, kind) {
  const ast = parseSource(source, kind);
  const { traverse } = ensureBabel();
  const meta = { nodesById: {}, order: [], unsupportedById: {}, componentName: 'App', lastPatchWarnings: [] };
  let i = 0;
  traverse.default(ast, {
    JSXElement(path) {
      const node = path.node;
      if (!isHostJSXName(node.openingElement.name)) return;
      const id = 'n' + (++i);
      const tag = jsxNameToString(node.openingElement.name);
      const reasons = [];
      if (hasSpreadAttrs(node)) reasons.push('包含 spread props');
      if (nonBlankChildren(node).some(c => c.type === 'JSXExpressionContainer')) reasons.push('包含动态表达式');
      meta.nodesById[id] = { id, tag, textOnly: isTextOnlyElement(node), staticContainer: isStaticContainer(node), canDelete: !!path.parentPath, canPatch: reasons.length === 0, reasons };
      if (reasons.length) meta.unsupportedById[id] = reasons.join('、');
      meta.order.push(id);
    },
    ExportDefaultDeclaration(path) {
      const d = path.node.declaration;
      if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) meta.componentName = d.id.name;
      if (d.type === 'Identifier') meta.componentName = d.name;
    }
  });
  return meta;
}
function jsxEditorPlugin(meta) {
  let i = 0;
  return function({ types: t }) { return { visitor: {
    ImportDeclaration(path) {
      if (path.node.source.value !== 'react') { path.remove(); return; }
      const decls = [];
      path.node.specifiers.forEach(sp => {
        if (sp.type === 'ImportDefaultSpecifier' || sp.type === 'ImportNamespaceSpecifier') {
          if (sp.local.name !== 'React') decls.push(t.variableDeclarator(t.identifier(sp.local.name), t.identifier('React')));
        } else if (sp.type === 'ImportSpecifier') {
          const imported = sp.imported.name || sp.imported.value;
          decls.push(t.variableDeclarator(t.identifier(sp.local.name), t.memberExpression(t.identifier('React'), t.identifier(imported))));
        }
      });
      if (decls.length) path.replaceWith(t.variableDeclaration('const', decls)); else path.remove();
    },
    ExportDefaultDeclaration(path) {
      const d = path.node.declaration;
      const target = t.memberExpression(t.identifier('window'), t.identifier('__HE_COMPONENT__'));
      if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) {
        path.replaceWithMultiple([d, t.expressionStatement(t.assignmentExpression('=', target, t.identifier(d.id.name)))]);
      } else {
        path.replaceWith(t.expressionStatement(t.assignmentExpression('=', target, d)));
      }
    },
    ExportNamedDeclaration(path) { if (path.node.declaration) path.replaceWith(path.node.declaration); else path.remove(); },
    JSXElement(path) {
      const node = path.node;
      if (!isHostJSXName(node.openingElement.name)) return;
      const id = 'n' + (++i);
      node.openingElement.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-he-id'), t.stringLiteral(id)));
    }
  }}; };
}
function transformJSXForPreview(source, kind, meta) {
  return Babel.transform(source, { presets: kind === 'tsx' ? ['react', 'typescript'] : ['react'], plugins: [jsxEditorPlugin(meta)], filename: kind === 'tsx' ? 'file.tsx' : 'file.jsx' }).code;
}
function scriptEscape(s) { return String(s).replace(/<\/script/gi, '<\\/script'); }
function buildJSXPreviewHTML(t) {
  try {
    const source = t.workingSource || t.sourceHTML || '';
    const meta = makeJsxMeta(source, t.kind);
    t.jsxMeta = meta;
    const code = transformJSXForPreview(source, t.kind, meta);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src="${assetURL('vendor/react.production.min.js')}"><\/script><script src="${assetURL('vendor/react-dom.production.min.js')}"><\/script><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.he-jsx-error{padding:18px;color:#b00020;background:#fff3f3;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace}</style></head><body><div id="root"></div><script>try{${scriptEscape(code)}\nvar C=window.__HE_COMPONENT__||window.App;if(!C)throw new Error('未找到默认导出的 React 组件');ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(C));}catch(e){document.body.innerHTML='<pre class="he-jsx-error">JSX 渲染失败\\n'+String(e&&e.stack||e).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})+'</pre>';}<\/script></body></html>`;
  } catch (e) {
    t.jsxMeta = { nodesById: {}, order: [], unsupportedById: {}, lastPatchWarnings: [String(e.message||e)] };
    return `<!DOCTYPE html><html><body><pre style="padding:18px;color:#b00020;background:#fff3f3;white-space:pre-wrap">JSX 编译失败\n${esc(e.message||e)}</pre></body></html>`;
  }
}
function collectJSXPaths(ast) {
  const map = {}; let i = 0;
  ensureBabel().traverse.default(ast, { JSXElement(path) { if (isHostJSXName(path.node.openingElement.name)) map['n' + (++i)] = path; } });
  return map;
}
function jsxText(v) { return v.replace(/\\/g, '\\\\').replace(/</g, '&lt;'); }
function domToJSXElement(el) {
  const { types: t } = ensureBabel();
  const tag = el.tagName.toLowerCase();
  if (!['p','img','div','span','h1','h2','h3','section','article','main'].includes(tag)) return null;
  const attrs = [];
  if (tag === 'img') {
    attrs.push(t.jsxAttribute(t.jsxIdentifier('src'), t.stringLiteral(el.getAttribute('src') || '')));
    if (el.getAttribute('alt')) attrs.push(t.jsxAttribute(t.jsxIdentifier('alt'), t.stringLiteral(el.getAttribute('alt'))));
  }
  if (el.style && el.style.fontSize) {
    attrs.push(t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(t.objectExpression([t.objectProperty(t.identifier('fontSize'), t.stringLiteral(el.style.fontSize))]))));
  }
  const selfClosing = tag === 'img';
  const children = selfClosing ? [] : [t.jsxText(jsxText(el.textContent || ''))];
  return t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier(tag), attrs, selfClosing), selfClosing ? null : t.jsxClosingElement(t.jsxIdentifier(tag)), children, selfClosing);
}
function setStyleFontSize(node, value) {
  if (!value) return;
  const { types: t } = ensureBabel();
  let attr = getAttr(node, 'style'), obj = null;
  if (attr && attr.value?.type === 'JSXExpressionContainer' && attr.value.expression?.type === 'ObjectExpression') obj = attr.value.expression;
  if (!obj) {
    obj = t.objectExpression([]);
    if (attr) attr.value = t.jsxExpressionContainer(obj); else node.openingElement.attributes.push(t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(obj)));
  }
  let prop = obj.properties.find(p => p.type === 'ObjectProperty' && ((p.key.type === 'Identifier' && p.key.name === 'fontSize') || (p.key.type === 'StringLiteral' && p.key.value === 'fontSize')));
  if (!prop) obj.properties.push(t.objectProperty(t.identifier('fontSize'), t.stringLiteral(value)));
  else prop.value = t.stringLiteral(value);
}
function cleanHTMLSnapshot(doc) {
  const es = doc.getElementById('__he_edit_css'); if (es) es.remove();
  doc.querySelectorAll('.__he-ed-active').forEach(el => el.classList.remove('__he-ed-active'));
  doc.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
  doc.querySelectorAll('[data-he-id]').forEach(el => el.removeAttribute('data-he-id'));
  doc.querySelectorAll('[data-he-unsupported]').forEach(el => el.removeAttribute('data-he-unsupported'));
  doc.querySelectorAll('[data-he-original-text]').forEach(el => el.removeAttribute('data-he-original-text'));
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}
function patchJSXSourceFromDOM(tab, doc) {
  const ast = parseSource(tab.workingSource || tab.sourceHTML || '', tab.kind);
  const { generator } = ensureBabel();
  const paths = collectJSXPaths(ast);
  const warnings = [];
  const meta = tab.jsxMeta || makeJsxMeta(tab.workingSource || tab.sourceHTML || '', tab.kind);
  Object.keys(paths).forEach(id => {
    const path = paths[id], node = path.node, info = meta.nodesById?.[id] || {};
    const el = doc.querySelector(`[data-he-id="${id}"]`);
    if (!el) { if (info.canDelete) path.remove(); else warnings.push(`${id}: 不支持删除`); return; }
    if (info.reasons && info.reasons.length) {
      if ((el.getAttribute('data-he-original-text') || '') !== (el.textContent || '')) warnings.push(`${id}: ${info.reasons.join('、')}，跳过源码回写`);
      return;
    }
    if (info.textOnly) {
      const kids = nonBlankChildren(node);
      if (kids[0]) kids[0].value = el.textContent || '';
    }
    if (isSameJSXName(node.openingElement.name, 'img')) {
      if (attrStaticString(node, 'src') || el.getAttribute('src')) setStringAttr(node, 'src', el.getAttribute('src') || '');
      if (attrStaticString(node, 'alt') || el.getAttribute('alt')) setStringAttr(node, 'alt', el.getAttribute('alt') || '');
    }
    if (el.style && el.style.fontSize) setStyleFontSize(node, el.style.fontSize);
    if (info.staticContainer) {
      const astChildById = {};
      (node.children || []).forEach(c => {
        if (c.type === 'JSXElement') {
          const a = getAttr(c, 'data-he-id');
          if (a?.value?.value) astChildById[a.value.value] = c;
        }
      });
      const rebuilt = [];
      let shouldReplace = false;
      Array.from(el.childNodes).forEach(child => {
        if (child.nodeType === 3) {
          if (child.textContent.trim()) rebuilt.push(ensureBabel().types.jsxText(child.textContent));
          return;
        }
        if (child.nodeType !== 1) return;
        const cid = child.getAttribute('data-he-id');
        if (cid && astChildById[cid]) rebuilt.push(astChildById[cid]);
        else {
          const made = domToJSXElement(child);
          if (made) { rebuilt.push(made); shouldReplace = true; }
          else warnings.push(`${id}: 无法回写新增 <${child.tagName.toLowerCase()}>`);
        }
      });
      if (shouldReplace) node.children = rebuilt;
    }
  });
  const source = generator.default(ast, { retainLines: true }).code.replace(/\s*data-he-id="n\d+"/g, '');
  return { source, warnings };
}
function buildCurrentOutput() {
  const t = getTab(), doc = getIframeDoc();
  if (!t) return { kind: 'html', content: '' };
  if (isJSXKind(t.kind)) {
    if (!doc) return { kind: t.kind, content: t.workingSource || t.sourceHTML || '', warnings: ['预览尚未加载'] };
    const result = patchJSXSourceFromDOM(t, doc);
    if (result.warnings.length) throw new Error('部分内容无法安全回写 JSX：\n' + result.warnings.join('\n'));
    t.workingSource = result.source; t.sourceHTML = result.source;
    return { kind: t.kind, content: result.source, filename: t.name };
  }
  return { kind: 'html', content: doc ? cleanHTMLSnapshot(doc) : (t.sourceHTML || ''), filename: t.name };
}
window.__buildCurrentOutput = function() { return buildCurrentOutput().content; };
window.__buildCurrentPayload = function() {
  const output = buildCurrentOutput();
  const t = getTab();
  return { content: output.content, html: output.content, kind: output.kind, path: t?.filePath || '', filename: t?.name || '' };
};

// ── 模式切换 ──
function updateModeButton() {
  const t = getTab();
  if (!t || t.isBlank) { btnMode.disabled = true; btnMode.textContent = '👁 预览模式'; btnMode.classList.remove('edit'); return; }
  btnMode.disabled = false;
  if (editMode) {
    btnMode.textContent = '✏️ 编辑中';
    btnMode.classList.add('edit');
  } else {
    btnMode.textContent = '👁 预览模式';
    btnMode.classList.remove('edit');
  }
}

function toggleMode() {
  const t = getTab();
  if (!t || t.isBlank) return;

  saveCurrentTabState();

  if (editMode) {
    const doc = getIframeDoc();
    if (doc) { removeEditing(doc); closeActive(); hideFbar(); }
    editMode = false;
    updateModeButton();
    toast('👁 已切换到预览模式');
  } else {
    editMode = true;
    updateModeButton();
    const doc = getIframeDoc();
    if (doc && doc.body) {
      injectEditing(doc);
    } else {
      whenIframeReady(() => {
        const d = getIframeDoc();
        if (d) injectEditing(d);
      });
    }
    toast('✏️ 已切换到编辑模式 · 点击元素即可编辑');
  }
}

// ── 编辑注入 / 移除 ──
function injectEditing(doc) {
  if (!doc || !doc.head || !doc.body) return;

  const old = doc.getElementById('__he_edit_css');
  if (old) old.remove();

  const style = doc.createElement('style');
  style.id = '__he_edit_css';
  style.textContent = `
    body { cursor: default; }
    *:not(body):not(html):not(head):hover { outline: 1px dashed #0078d460; }
    .__he-ed-active { outline: 2px solid #0078d4 !important; outline-offset: 1px; }
    img:hover { outline: 2px dashed #e94566 !important; cursor: pointer; }
    [data-he-unsupported="1"] { outline-color: #f39c1260 !important; }
  `;
  doc.head.appendChild(style);

  const t = getTab();
  if (isJSXKind(t?.kind) && t.jsxMeta?.unsupportedById) {
    doc.querySelectorAll('[data-he-id]').forEach(el => {
      const id = el.getAttribute('data-he-id');
      if (t.jsxMeta.unsupportedById[id]) {
        el.setAttribute('data-he-unsupported', '1');
        if (!el.hasAttribute('data-he-original-text')) el.setAttribute('data-he-original-text', el.textContent || '');
      }
    });
  }

  doc.addEventListener('mousedown', onIframeMousedown, true);
  doc.addEventListener('dblclick', onIframeDblclick);

  if (iframeMutObs) iframeMutObs.disconnect();
  iframeMutObs = new MutationObserver(() => setUnsaved(true));
  iframeMutObs.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true });
}

function removeEditing(doc) {
  if (!doc) return;
  const style = doc.getElementById('__he_edit_css');
  if (style) style.remove();
  doc.querySelectorAll('.__he-ed-active').forEach(el => {
    el.contentEditable = 'false';
    el.classList.remove('__he-ed-active');
  });
  doc.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
  doc.removeEventListener('mousedown', onIframeMousedown, true);
  doc.removeEventListener('dblclick', onIframeDblclick);
  if (iframeMutObs) { iframeMutObs.disconnect(); iframeMutObs = null; }
}

// ── iframe 中的事件处理 ──
function onIframeMousedown(e) {
  if (!editMode) return;
  const doc = getIframeDoc();
  if (!doc) return;
  if (e.target === doc.body) { closeActive(); return; }
  selectEl(e.target);
}

function onIframeDblclick(e) {
  if (!editMode) return;
  const doc = getIframeDoc();
  if (!doc) return;
  const el = e.target;
  if (el === doc.body || el.tagName === 'IMG') return;
  makeEditable(el);
  const range = doc.createRange(); range.selectNodeContents(el);
  const sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(range);
}

// ── 父窗口点击外部关闭选中 ──
document.addEventListener('mousedown', e => {
  if (!editMode) return;
  if (e.target === previewFrame || (!previewFrame.contains(e.target) && !fbar.contains(e.target))) {
    closeActive();
  }
});

// ── 选中元素 ──
function selectEl(el) {
  if (activeEl && activeEl !== el) deactivateEl(activeEl);
  activeEl = el; activeImg = el.tagName === 'IMG' ? el : null;
  window.activeImg = activeImg;
  const t = getTab();
  const heId = el.getAttribute && el.getAttribute('data-he-id');
  if (isJSXKind(t?.kind) && heId && t.jsxMeta?.unsupportedById?.[heId]) {
    toast('⚠️ 此节点包含动态 JSX：' + t.jsxMeta.unsupportedById[heId]);
  }
  if (el.tagName !== 'IMG') makeEditable(el);
  const sz = Math.round(parseFloat(getComputedStyle(el).fontSize));
  document.getElementById('fb-sz').value = sz;
  document.getElementById('fb-repl-img').style.display = activeImg ? 'inline-block' : 'none';
  showFbar(el);
}

function makeEditable(el) {
  el.contentEditable = 'true';
  el.classList.add('__he-ed-active');
}

function deactivateEl(el) {
  if (!el) return;
  el.contentEditable = 'false';
  el.classList.remove('__he-ed-active');
}

function closeActive() {
  deactivateEl(activeEl);
  activeEl = null; activeImg = null;
  window.activeImg = null;
  hideFbar();
}

// ── 浮动工具条（iframe 坐标转换） ──
function showFbar(el) {
  fbar.classList.add('show');
  requestAnimationFrame(() => {
    const ifr = previewFrame.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    let top = ifr.top + er.top - fbar.offsetHeight - 10;
    if (top < 6) top = ifr.top + er.bottom + 10;
    let left = ifr.left + er.left;
    if (left + fbar.offsetWidth > window.innerWidth - 8) left = window.innerWidth - fbar.offsetWidth - 8;
    left = Math.max(8, left);
    fbar.style.top = top + 'px';
    fbar.style.left = left + 'px';
  });
}

function hideFbar() { fbar.classList.remove('show'); }

// ── 字号 ──
function applySize(px) {
  if (!px || px < 1) return;
  const doc = getIframeDoc();
  if (!doc) return;
  const sel = doc.getSelection();
  if (sel && !sel.isCollapsed && doc.body.contains(sel.anchorNode)) {
    doc.execCommand('fontSize', false, '7');
    doc.querySelectorAll('font[size="7"]').forEach(f => {
      const span = doc.createElement('span');
      span.style.fontSize = px + 'px';
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    });
  } else if (activeEl) {
    activeEl.style.fontSize = px + 'px';
  }
}

// ── 新增文字行 ──
function addTextRow(after) {
  const doc = getIframeDoc();
  if (!doc) return;
  const p = doc.createElement('p');
  p.style.cssText = 'margin:8px 0;padding:2px 0;min-height:1.5em;';
  p.textContent = '双击编辑文字';
  if (after && after.parentNode) after.parentNode.insertBefore(p, after.nextSibling);
  else doc.body.appendChild(p);
  deactivateEl(activeEl);
  activeEl = p; activeImg = null;
  makeEditable(p);
  p.focus();
  requestAnimationFrame(() => {
    const r = doc.createRange(); r.selectNodeContents(p);
    const s = doc.getSelection(); s.removeAllRanges(); s.addRange(r);
    showFbar(p);
  });
}

// ── 新增图片行 ──
let pendingImgTarget = null;

function addImageRow(after) {
  pendingImgTarget = after;
  document.getElementById('img-in').click();
}

document.getElementById('img-in').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;

  const reader = new FileReader();
  reader.onload = ev => {
    const doc = getIframeDoc();
    if (!doc) return;
    if (activeImg) {
      activeImg.src = ev.target.result;
      toast('✅ 图片已替换');
      return;
    }
    const img = doc.createElement('img');
    img.src = ev.target.result;
    img.style.cssText = 'max-width:100%;display:block;margin:8px 0;';
    const target = pendingImgTarget;
    if (target && target !== doc.body && target.parentNode) {
      target.parentNode.insertBefore(img, target.nextSibling);
    } else {
      doc.body.appendChild(img);
    }
    pendingImgTarget = null;
    deactivateEl(activeEl);
    activeEl = img; activeImg = img;
    hideFbar();
    document.getElementById('fb-repl-img').style.display = 'inline-block';
    showFbar(img);
    toast('✅ 图片已插入');
  };
  reader.readAsDataURL(f);
});

// ── 替换图片 ──
function startReplaceImg() {
  if (!activeImg) return;
  document.getElementById('img-in').click();
}

// ── 删除 ──
function deleteEl() {
  const doc = getIframeDoc();
  if (!activeEl || activeEl === (doc ? doc.body : null)) return;
  if (!confirm('确定删除此元素？')) return;
  activeEl.remove();
  activeEl = null; activeImg = null;
  window.activeImg = null;
  hideFbar();
}

// ── 原生 App 桥接 ──
function isNativeApp() { return false; }
window.__loadHTMLContent = function(data) {
  const source = data.source || data.html || '';
  const filename = data.filename || 'untitled.html';
  const kind = data.kind || detectKind(filename);
  if (isJSXKind(kind)) { createTab(filename, null, source, '', '', kind, data.path || ''); return; }
  const doc = new DOMParser().parseFromString(source, 'text/html');
  let s = '';
  doc.querySelectorAll('style').forEach(el => { s += el.outerHTML + '\n'; });
  createTab(filename, null, source, s, doc.body ? doc.body.innerHTML : '', kind, data.path || '');
};

// ── 下载列表回调 ──
window.__receiveDownloadsList = function(files) {
  const list = document.getElementById('dl-list');
  if (!files || files.length === 0) {
    list.innerHTML = '<div class="dl-empty">暂无 HTML 文件</div>';
    return;
  }
  list.innerHTML = files.map(f => {
    return `<div class="dl-item" data-path="${esc(f.path)}">
      <span class="dl-icon">📄</span>
      <div class="dl-info"><div class="dl-name">${esc(f.name)}</div><div class="dl-date">${esc(f.path)}</div></div>
    </div>`;
  }).join('');
  list.querySelectorAll('.dl-item').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.dataset.path;
      if (isNativeApp()) {
        window.webkit.messageHandlers.editorBridge.postMessage({ action: 'openPath', path: path });
      }
    });
  });
};

function refreshDownloads() {}

// ── 文件操作 ──
async function openFile() {
  document.getElementById('file-in').click();
}

document.getElementById('file-in').addEventListener('change', e => {
  const f = e.target.files[0]; if (f) loadHTML(f); e.target.value = '';
});

async function loadHTML(file) {
  const txt = await file.text();
  const kind = detectKind(file.name);
  if (isJSXKind(kind)) { createTab(file.name, file, txt, '', '', kind); return; }
  const doc = new DOMParser().parseFromString(txt, 'text/html');
  let s = '';
  doc.querySelectorAll('style').forEach(el => { s += el.outerHTML + '\n'; });
  createTab(file.name, file, txt, s, doc.body ? doc.body.innerHTML : '', kind);
}

async function saveFile() {
  const t = getTab();
  let output;
  try {
    output = buildCurrentOutput();
  } catch (e) {
    toast('⚠️ ' + (e.message || e));
    return;
  }
  const doc = getIframeDoc();
  if (editMode && doc) injectEditing(doc);

  if (isNativeApp()) {
    window.webkit.messageHandlers.editorBridge.postMessage({ action: 'save', content: output.content, html: output.content, kind: output.kind, path: t?.filePath || '' });
    return;
  }
  if (t && t.fHandle && !isJSXKind(t.kind)) {
    try { const w = await t.fHandle.createWritable(); await w.write(output.content); await w.close(); setUnsaved(false); toast('✅ 已保存'); return; }
    catch(e) {}
  }
  const a = document.createElement('a');
  const mime = isJSXKind(output.kind) ? 'text/javascript;charset=utf-8' : 'text/html;charset=utf-8';
  a.href = URL.createObjectURL(new Blob([output.content], { type: mime }));
  a.download = t?.name || (isJSXKind(output.kind) ? 'edited.jsx' : 'edited.html');
  a.click(); URL.revokeObjectURL(a.href);
  setUnsaved(false); toast(isJSXKind(output.kind) ? '✅ JSX 源码已下载' : '✅ 已下载');
}

window.__saveDone = function(success) {
  if (success) { setUnsaved(false); toast('✅ 已保存'); } else { toast('❌ 保存失败'); }
};
window.__saveAsDone = function(success) {
  if (success) { setUnsaved(false); toast('✅ 已另存'); } else { toast('❌ 另存失败'); }
};

function setUnsaved(v) {
  const t = getTab(); if (t) t.unsaved = v;
  unsavedEl.classList.toggle('show', v);
  renderTabs();
}

// ── 工具栏按钮 ──
document.getElementById('btn-open').addEventListener('click', openFile);
document.getElementById('btn-save').addEventListener('click', saveFile);
document.getElementById('btn-new-tab').addEventListener('click', createBlankTab);
btnMode.addEventListener('click', toggleMode);

// ── 浮动工具条按钮 ──
document.getElementById('fb-apply').addEventListener('click', () => applySize(parseInt(document.getElementById('fb-sz').value)));
document.getElementById('fb-aplus').addEventListener('click', () => {
  const sz = Math.min(200, parseInt(document.getElementById('fb-sz').value || 16) + 2);
  document.getElementById('fb-sz').value = sz; applySize(sz);
});
document.getElementById('fb-aminus').addEventListener('click', () => {
  const sz = Math.max(6, parseInt(document.getElementById('fb-sz').value || 16) - 2);
  document.getElementById('fb-sz').value = sz; applySize(sz);
});
document.getElementById('fb-add-text').addEventListener('click', () => addTextRow(activeEl));
document.getElementById('fb-add-img').addEventListener('click', () => addImageRow(activeEl));
document.getElementById('fb-repl-img').addEventListener('click', startReplaceImg);
document.getElementById('fb-del').addEventListener('click', deleteEl);

// ── 快捷键 ──
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (!btnSave.disabled) saveFile(); }
  if (e.key === 'Escape') closeActive();
  if ((e.metaKey || e.ctrlKey) && e.key === 'e') { e.preventDefault(); toggleMode(); }
});

// ── 拖放 ──
const dropMask = document.getElementById('drop-mask'); let dragD = 0;
document.addEventListener('dragenter', e => {
  e.preventDefault(); dragD++;
  if ([...e.dataTransfer.items].some(i => i.type === 'text/html' || i.type === 'text/javascript' || i.type === '')) dropMask.classList.add('show');
});
document.addEventListener('dragleave', () => { if (--dragD <= 0) { dragD=0; dropMask.classList.remove('show'); } });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault(); dragD=0; dropMask.classList.remove('show');
  const f = e.dataTransfer.files[0]; if (f && SUPPORTED_EXT_RE.test(f.name)) loadHTML(f);
});

// ── Toast ──
function toast(msg, ms=2200) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), ms);
}

// 初始加载下载列表
refreshDownloads();