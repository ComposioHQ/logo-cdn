const http = require('http');
const fs = require('fs');
const path = require('path');

// Base directory for the project
const PROJECT_ROOT = '/Users/malayvasa/Developer/GitHub/logo-cdn';

// Load sharp from local node_modules
let sharp, icojs;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('[Warning] sharp not available - install with: bun add sharp');
}

// icojs is ESM, load it async at startup
(async () => {
  try {
    icojs = await import('icojs');
    console.log('[Info] icojs loaded');
  } catch (e) {
    console.log('[Warning] icojs not available - BMP ICO conversion will fail:', e.message);
  }
})();

const ASSETS_DIR = path.join(PROJECT_ROOT, 'src/assets');
const TEMP_DIR = path.join(PROJECT_ROOT, 'temp');
const PROGRESS_CSV = path.join(TEMP_DIR, 'logo_progress.csv');
const BROKEN_PROGRESS_CSV = path.join(TEMP_DIR, 'broken_logos_progress.csv');
const BROKEN_INPUT_CSV = path.join(TEMP_DIR, 'broken_logos.csv');
const PENDING_DIR = path.join(TEMP_DIR, 'pending');
const PORT = 3333;

// Composio API for toolkit data
const COMPOSIO_API_URL = 'https://backend.composio.dev/api/v3/toolkits?sort_by=usage';
const COMPOSIO_API_KEY = 'y4ru2vrbb1ms91rowhcelk';

// Vectorizer API credentials (replace with your own if needed)
const VECTORIZER_API_KEY = process.env.VECTORIZER_API_KEY || 'vkig9acadmc83pp';
const VECTORIZER_API_SECRET = process.env.VECTORIZER_API_SECRET || '7tbpgt4pnjrd8efnpc8abmibkis1n52s12n4rp465udrd4duosg4';

// Ensure temp directories exist
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  console.log('[Info] Created temp directory:', TEMP_DIR);
}
if (!fs.existsSync(PENDING_DIR)) {
  fs.mkdirSync(PENDING_DIR, { recursive: true });
  console.log('[Info] Created pending directory:', PENDING_DIR);
}

// Helper: detect if SVG only uses white/light colors (invisible on light backgrounds)
function isWhiteOnlySvg(svgContent) {
  const lower = svgContent.toLowerCase();
  
  // Check for explicit white fills or strokes
  const whiteColorPatterns = [
    /#fff(?:fff)?(?![0-9a-f])/gi,  // #fff or #ffffff
    /white/gi,
    /rgb\s*\(\s*255\s*,\s*255\s*,\s*255\s*\)/gi,
    /rgba\s*\(\s*255\s*,\s*255\s*,\s*255\s*,\s*[01](?:\.\d+)?\s*\)/gi
  ];
  
  // Check for non-white colors
  const nonWhitePatterns = [
    /#(?![fF]{3}(?:[fF]{3})?(?![0-9a-fA-F]))[0-9a-fA-F]{3,6}/g, // hex colors that aren't white
    /rgb\s*\(\s*(?!255\s*,\s*255\s*,\s*255)/gi, // rgb not white
    /fill\s*[=:]\s*["']?(?!#fff|#ffffff|white|none|transparent)/gi,
    /stroke\s*[=:]\s*["']?(?!#fff|#ffffff|white|none|transparent)/gi,
    /stop-color\s*[=:]\s*["']?(?!#fff|#ffffff|white)/gi
  ];
  
  // If any non-white color is found, it's not white-only
  for (const pattern of nonWhitePatterns) {
    if (pattern.test(svgContent)) {
      return false;
    }
  }
  
  // Check if there are shapes that would be visible
  const hasShapes = /<(path|rect|circle|ellipse|polygon|polyline|line|text)\b/i.test(svgContent);
  if (!hasShapes) return false;
  
  // Check for any white color usage
  let hasWhite = false;
  for (const pattern of whiteColorPatterns) {
    if (pattern.test(svgContent)) {
      hasWhite = true;
      break;
    }
  }
  
  // Check for shapes without fill (default fill is black, so NOT white-only)
  // But if fill="none" and stroke is white, that's white-only
  const hasFillAttr = /fill\s*=/i.test(svgContent);
  const hasStrokeAttr = /stroke\s*=/i.test(svgContent);
  
  // If has white color and no non-white colors detected
  if (hasWhite) return true;
  
  // If shapes exist but no colors specified at all, check for currentColor or inherited
  if (hasShapes && !hasFillAttr && !hasStrokeAttr) {
    // No fill/stroke means default black fill, not white-only
    return false;
  }
  
  // Check for fill="none" with white stroke
  if (/fill\s*=\s*["']?none/i.test(svgContent) && hasWhite) {
    return true;
  }
  
  return false;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SVG Viewer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .cell.hidden { display: none; }
    .toast.show { opacity: 1 !important; }
  </style>
</head>
<body class="min-h-dvh bg-neutral-50">
  <!-- Header -->
  <header class="sticky top-0 z-10 border-b border-neutral-200 bg-white px-4 py-3">
    <div class="flex flex-wrap items-center gap-3">
      <span class="text-sm font-semibold tabular-nums text-neutral-900" id="totalCount">0 logos</span>
      
      <button 
        id="modifiedBtn" 
        class="hidden items-center gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700 hover:bg-green-100"
      >
        <span class="size-2 rounded-full bg-green-500"></span>
        <span id="modifiedCount">0</span> modified
      </button>
      
      <input 
        type="text" 
        id="search" 
        placeholder="Search SVGs..." 
        class="min-w-[200px] flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
      >
      
      <button 
        id="whiteOnlyBtn" 
        class="filter-btn inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50"
      >
        <span class="size-3 shrink-0 rounded-full border border-neutral-400 bg-white"></span>
        White Only
        <span class="rounded bg-neutral-100 px-1.5 py-0.5 text-xs tabular-nums" id="whiteCount">...</span>
      </button>
      
      <span class="text-sm tabular-nums text-neutral-500" id="selectedCount">0 selected</span>
      
      <button 
        id="copyBtn" 
        disabled 
        class="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        Copy Selected
      </button>
      
      <a 
        href="/progress" 
        class="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50"
      >
        Progress →
      </a>
    </div>
  </header>

  <!-- Grid -->
  <main id="grid" class="flex flex-wrap gap-px bg-neutral-300 p-px"></main>

  <!-- Hidden file input for replacing SVGs -->
  <input type="file" id="replaceInput" accept=".svg" class="hidden">

  <!-- Toast -->
  <div 
    id="toast" 
    class="toast pointer-events-none fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-neutral-900 px-4 py-3 text-sm text-white opacity-0 shadow-lg"
  ></div>

  <script>
    let svgs = [];
    let selected = new Set();
    let whiteOnlySvgs = new Set();
    let showWhiteOnly = false;
    let toolkitUrls = {};
    let modifiedFiles = new Set();

    async function loadSvgs() {
      try {
        // Load all data in parallel
        const [listRes, whiteRes, urlsRes] = await Promise.all([
          fetch('/api/list'),
          fetch('/api/white-only'),
          fetch('/api/toolkit-urls')
        ]);
        
        svgs = await listRes.json();
        document.getElementById('totalCount').textContent = svgs.length + ' logos';
        
        // Load white-only SVGs
        const whiteList = await whiteRes.json();
        whiteOnlySvgs = new Set(whiteList);
        document.getElementById('whiteCount').textContent = whiteList.length;
        
        // Load toolkit URLs from Composio
        toolkitUrls = await urlsRes.json();
        console.log('Loaded', Object.keys(toolkitUrls).length, 'toolkit URLs');
        
        render();
      } catch (err) {
        console.error('Error loading data:', err);
        showToast('Error loading data: ' + err.message);
      }
    }

    function render() {
      const query = document.getElementById('search').value.toLowerCase();
      const grid = document.getElementById('grid');
      
      grid.innerHTML = svgs.map((name, i) => {
        const matchesSearch = name.toLowerCase().includes(query);
        const matchesWhite = !showWhiteOnly || whiteOnlySvgs.has(name);
        const isSelected = selected.has(name);
        const isWhite = whiteOnlySvgs.has(name);
        const isModified = modifiedFiles.has(name);
        const slug = name.replace('.svg', '');
        const siteUrl = toolkitUrls[slug] || '';
        const hasUrl = siteUrl && siteUrl.length > 0;
        return \`
          <div class="cell group relative flex flex-col \${isSelected ? 'ring-2 ring-neutral-900' : ''} \${isModified ? 'ring-2 ring-green-500' : ''} \${matchesSearch && matchesWhite ? '' : 'hidden'}" data-name="\${name}">
            \${isModified ? '<div class="absolute right-1 top-1 z-10 size-2 rounded-full bg-green-500" title="Modified"></div>' : ''}
            <!-- Logo Preview -->
            <div class="relative flex size-32 items-center justify-center \${isWhite ? 'bg-neutral-800' : 'bg-neutral-100'}">
              <img src="/svg/\${name}" alt="\${name}" loading="lazy" class="max-h-full max-w-full object-contain">
              <!-- Replace overlay -->
              <button 
                class="replace-btn absolute inset-0 flex cursor-pointer items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100" 
                data-name="\${name}"
                aria-label="Replace \${slug}"
              >
                <span class="rounded bg-white px-2 py-1 text-xs font-medium text-neutral-900">Replace</span>
              </button>
            </div>
            
            <!-- Footer -->
            <div class="flex w-32 items-center gap-1 bg-white px-1 py-1">
              <input 
                type="checkbox" 
                class="cell-checkbox size-3.5 shrink-0 cursor-pointer accent-neutral-900" 
                \${isSelected ? 'checked' : ''} 
                data-name="\${name}"
                aria-label="Select \${slug}"
              >
              <input 
                type="text" 
                class="cell-name min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-100 focus:border-neutral-400 focus:bg-white focus:outline-none" 
                value="\${slug}" 
                data-original="\${name}" 
                title="\${name}\${isWhite ? ' (white-only)' : ''}"
              >
              \${hasUrl ? \`
                <a 
                  href="\${siteUrl}" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  class="flex size-5 shrink-0 items-center justify-center rounded border border-neutral-200 bg-white text-[10px] text-neutral-400 hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-600" 
                  title="Open \${siteUrl}"
                  aria-label="Open \${slug} website"
                >↗</a>
              \` : ''}
            </div>
          </div>
        \`;
      }).join('');

      updateSelectedCount();
    }

    function updateSelectedCount() {
      const count = selected.size;
      document.getElementById('selectedCount').textContent = count + ' selected';
      document.getElementById('copyBtn').disabled = count === 0;
    }
    
    function updateModifiedCount() {
      const count = modifiedFiles.size;
      const btn = document.getElementById('modifiedBtn');
      const countEl = document.getElementById('modifiedCount');
      
      if (count > 0) {
        btn.classList.remove('hidden');
        btn.classList.add('inline-flex');
        countEl.textContent = count;
      } else {
        btn.classList.add('hidden');
        btn.classList.remove('inline-flex');
      }
    }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }

    document.getElementById('search').addEventListener('input', render);
    
    document.getElementById('whiteOnlyBtn').addEventListener('click', () => {
      showWhiteOnly = !showWhiteOnly;
      const btn = document.getElementById('whiteOnlyBtn');
      if (showWhiteOnly) {
        btn.classList.add('border-red-400', 'bg-red-50', 'text-red-700');
        btn.classList.remove('border-neutral-300', 'bg-white', 'text-neutral-600');
      } else {
        btn.classList.remove('border-red-400', 'bg-red-50', 'text-red-700');
        btn.classList.add('border-neutral-300', 'bg-white', 'text-neutral-600');
      }
      render();
    });

    document.getElementById('grid').addEventListener('change', (e) => {
      if (e.target.classList.contains('cell-checkbox')) {
        const name = e.target.dataset.name;
        if (e.target.checked) {
          selected.add(name);
        } else {
          selected.delete(name);
        }
        e.target.closest('.cell').classList.toggle('selected', e.target.checked);
        updateSelectedCount();
      }
    });

    document.getElementById('grid').addEventListener('keydown', async (e) => {
      if (e.target.classList.contains('cell-name') && e.key === 'Enter') {
        e.preventDefault();
        const input = e.target;
        const oldName = input.dataset.original;
        const newName = input.value.trim() + '.svg';
        
        if (newName === oldName || !newName || newName === '.svg') {
          input.value = oldName.replace('.svg', '');
          input.blur();
          return;
        }

        try {
          const res = await fetch('/api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName, newName })
          });
          
          if (res.ok) {
            const idx = svgs.indexOf(oldName);
            if (idx !== -1) svgs[idx] = newName;
            
            if (selected.has(oldName)) {
              selected.delete(oldName);
              selected.add(newName);
            }
            
            input.dataset.original = newName;
            input.closest('.cell').dataset.name = newName;
            input.closest('.cell').querySelector('.cell-checkbox').dataset.name = newName;
            input.closest('.cell').querySelector('img').src = '/svg/' + newName;
            input.closest('.cell').querySelector('img').alt = newName;
            input.title = newName;
            
            showToast('Renamed to ' + newName);
          } else {
            const err = await res.text();
            showToast('Error: ' + err);
            input.value = oldName.replace('.svg', '');
          }
        } catch (err) {
          showToast('Error: ' + err.message);
          input.value = oldName.replace('.svg', '');
        }
        input.blur();
      }
    });

    document.getElementById('grid').addEventListener('blur', (e) => {
      if (e.target.classList.contains('cell-name')) {
        e.target.value = e.target.dataset.original.replace('.svg', '');
      }
    }, true);

    document.getElementById('copyBtn').addEventListener('click', () => {
      const names = Array.from(selected).sort().join(', ');
      navigator.clipboard.writeText(names).then(() => {
        showToast('Copied ' + selected.size + ' names to clipboard');
      });
    });
    
    document.getElementById('modifiedBtn').addEventListener('click', () => {
      const files = Array.from(modifiedFiles).sort();
      const fileList = files.map(f => 'src/assets/' + f).join('\\n');
      const gitCmd = 'git add ' + files.map(f => 'src/assets/' + f).join(' ');
      
      const message = \`Modified files (\\$\{files.length\}):\\n\\n\${fileList}\\n\\n---\\nGit commands:\\n\\n\${gitCmd}\\n\\ngit commit -m "fix: update \${files.length} logo(s)"\`;
      
      if (confirm(message + '\\n\\nCopy git commands to clipboard?')) {
        navigator.clipboard.writeText(gitCmd + \` && git commit -m "fix: update \${files.length} logo(s)"\`).then(() => {
          showToast('Git commands copied to clipboard');
        });
      }
    });

    // Replace functionality
    let currentReplaceName = null;
    const replaceInput = document.getElementById('replaceInput');
    
    document.getElementById('grid').addEventListener('click', (e) => {
      const replaceBtn = e.target.closest('.replace-btn');
      if (replaceBtn) {
        e.preventDefault();
        currentReplaceName = replaceBtn.dataset.name;
        replaceInput.click();
      }
    });
    
    replaceInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !currentReplaceName) return;
      
      if (!file.name.endsWith('.svg')) {
        showToast('Please select an SVG file');
        return;
      }
      
      try {
        const content = await file.text();
        const res = await fetch('/api/replace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: currentReplaceName, content })
        });
        
        if (res.ok) {
          // Track modified file
          modifiedFiles.add(currentReplaceName);
          updateModifiedCount();
          
          showToast('Replaced ' + currentReplaceName);
          // Refresh the image by adding cache buster
          const img = document.querySelector(\`.cell[data-name="\${currentReplaceName}"] img\`);
          if (img) {
            img.src = '/svg/' + currentReplaceName + '?t=' + Date.now();
          }
          // Reload white-only list in case it changed
          const whiteRes = await fetch('/api/white-only');
          const whiteList = await whiteRes.json();
          whiteOnlySvgs = new Set(whiteList);
          document.getElementById('whiteCount').textContent = whiteList.length;
          render();
        } else {
          const err = await res.text();
          showToast('Error: ' + err);
        }
      } catch (err) {
        showToast('Error: ' + err.message);
      }
      
      // Reset
      replaceInput.value = '';
      currentReplaceName = null;
    });

    loadSvgs();
  </script>
</body>
</html>`;

const progressHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Logo Progress</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'JetBrains Mono', 'SF Mono', Monaco, monospace; 
      background: #0d1117; 
      color: #c9d1d9; 
      min-height: 100vh; 
      padding: 24px;
    }
    
    .header { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #21262d;
    }
    
    h1 { 
      font-size: 20px; 
      font-weight: 500;
      color: #58a6ff;
      letter-spacing: -0.5px;
    }
    
    .header-actions {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    
    .nav-link {
      color: #8b949e;
      text-decoration: none;
      font-size: 13px;
      padding: 6px 12px;
      border: 1px solid #30363d;
      border-radius: 6px;
      transition: all 0.15s;
    }
    .nav-link:hover { 
      color: #c9d1d9;
      border-color: #8b949e;
    }
    
    .filter-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 24px;
    }
    
    .filter-tab {
      background: transparent;
      border: 1px solid #30363d;
      color: #8b949e;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .filter-tab:hover { border-color: #8b949e; color: #c9d1d9; }
    .filter-tab.active { background: #21262d; color: #c9d1d9; border-color: #58a6ff; }
    
    .stats {
      display: flex;
      gap: 16px;
      margin-bottom: 24px;
    }
    
    .stat-card {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 8px;
      padding: 16px 20px;
      min-width: 120px;
    }
    
    .stat-value {
      font-size: 28px;
      font-weight: 600;
      color: #58a6ff;
    }
    
    .stat-value.success { color: #3fb950; }
    .stat-value.pending { color: #d29922; }
    .stat-value.error { color: #f85149; }
    
    .stat-label {
      font-size: 12px;
      color: #8b949e;
      margin-top: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .table-container {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 8px;
      overflow: hidden;
    }
    
    table { 
      width: 100%; 
      border-collapse: collapse; 
      font-size: 13px;
    }
    
    th { 
      background: #21262d;
      color: #8b949e;
      font-weight: 500;
      text-align: left;
      padding: 12px 16px;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #30363d;
    }
    
    td { 
      padding: 12px 16px;
      border-bottom: 1px solid #21262d;
      vertical-align: middle;
    }
    
    tr:last-child td { border-bottom: none; }
    
    tr:hover td { background: #1c2128; }
    
    .slug { 
      font-weight: 500;
      color: #c9d1d9;
    }
    
    .url-link {
      color: #58a6ff;
      text-decoration: none;
      max-width: 200px;
      display: inline-block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .url-link:hover { text-decoration: underline; }
    
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
    }
    
    .badge.true, .badge.True { 
      background: rgba(63, 185, 80, 0.15);
      color: #3fb950;
    }
    
    .badge.false, .badge.False { 
      background: rgba(210, 153, 34, 0.15);
      color: #d29922;
    }
    
    .badge::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    
    .source-tag {
      background: #21262d;
      color: #8b949e;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
    }
    
    .preview-img {
      width: 32px;
      height: 32px;
      object-fit: contain;
      background: #fff;
      border-radius: 4px;
      padding: 2px;
    }
    
    .pending-previews {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    
    .pending-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 8px;
      background: #21262d;
      border-radius: 6px;
      border: 1px solid #30363d;
    }
    
    .pending-item img {
      width: 48px;
      height: 48px;
      object-fit: contain;
      background: #fff;
      border-radius: 4px;
    }
    
    .pending-source {
      font-size: 10px;
      color: #8b949e;
    }
    
    .vectorize-btn {
      background: #238636;
      border: none;
      color: #fff;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 10px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .vectorize-btn:hover { background: #2ea043; }
    .vectorize-btn:disabled { background: #21262d; color: #8b949e; cursor: not-allowed; }
    
    .empty-state {
      padding: 48px;
      text-align: center;
      color: #8b949e;
    }
    
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #238636;
      color: #fff;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13px;
      opacity: 0;
      transition: opacity 0.3s;
      z-index: 1000;
    }
    .toast.error { background: #da3633; }
    .toast.show { opacity: 1; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Logo Progress Tracker</h1>
    <div class="header-actions">
      <a href="/" class="nav-link">← Back to SVG Viewer</a>
    </div>
  </div>
  
  <div class="filter-tabs">
    <button class="filter-tab active" data-filter="all">All</button>
    <button class="filter-tab" data-filter="pending">Pending Review</button>
    <button class="filter-tab" data-filter="found">Found</button>
    <button class="filter-tab" data-filter="notfound">Not Found</button>
  </div>
  
  <div class="stats" id="stats"></div>
  
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Preview</th>
          <th>Slug</th>
          <th>App URL</th>
          <th>Status</th>
          <th>Source</th>
          <th>Pending Files</th>
        </tr>
      </thead>
      <tbody id="tableBody"></tbody>
    </table>
  </div>
  
  <div class="toast" id="toast"></div>

  <script>
    let allData = [];
    let currentFilter = 'all';
    
    function showToast(msg, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.className = 'toast show' + (isError ? ' error' : '');
      setTimeout(() => toast.className = 'toast', 3000);
    }
    
    async function vectorize(pendingPath, slug) {
      const btn = event.target;
      btn.disabled = true;
      btn.textContent = 'Processing...';
      
      try {
        const res = await fetch('/api/vectorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pendingPath, slug })
        });
        
        if (res.ok) {
          showToast('Vectorized and saved: ' + slug + '.svg');
          loadProgress(); // reload data
        } else {
          const err = await res.text();
          showToast('Error: ' + err, true);
          btn.disabled = false;
          btn.textContent = 'Vectorize';
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
        btn.disabled = false;
        btn.textContent = 'Vectorize';
      }
    }
    
    function renderPendingFiles(pendingFiles, slug) {
      if (!pendingFiles) return '—';
      const files = pendingFiles.split(';').filter(f => f.trim());
      if (files.length === 0) return '—';
      
      return files.map(filepath => {
        const filename = filepath.split('/').pop();
        const source = filename.includes('_brandfetch') ? 'brandfetch' : 
                      filename.includes('_firecrawl') ? 'firecrawl' : 'unknown';
        return \`
          <div class="pending-item">
            <img src="/pending/\${filename}" alt="\${filename}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22><text y=%2220%22>?</text></svg>'">
            <span class="pending-source">\${source}</span>
            <button class="vectorize-btn" onclick="vectorize('\${filepath}', '\${slug}')">Vectorize</button>
          </div>
        \`;
      }).join('');
    }
    
    function getRowStatus(row) {
      if (row.found === 'True') return { label: 'Found', class: 'true' };
      if (row.pending_files && row.pending_files.trim()) return { label: 'Pending', class: 'false' };
      return { label: 'Not Found', class: 'false' };
    }
    
    function filterData(data, filter) {
      if (filter === 'all') return data;
      if (filter === 'pending') return data.filter(r => r.found !== 'True' && r.pending_files && r.pending_files.trim());
      if (filter === 'found') return data.filter(r => r.found === 'True');
      if (filter === 'notfound') return data.filter(r => r.found !== 'True' && (!r.pending_files || !r.pending_files.trim()));
      return data;
    }

    async function loadProgress() {
      const res = await fetch('/api/progress');
      allData = await res.json();
      renderTable();
    }
    
    function renderTable() {
      const data = filterData(allData, currentFilter);
      
      // Stats
      const total = allData.length;
      const found = allData.filter(r => r.found === 'True').length;
      const pending = allData.filter(r => r.found !== 'True' && r.pending_files && r.pending_files.trim()).length;
      const notFound = total - found - pending;
      
      document.getElementById('stats').innerHTML = \`
        <div class="stat-card">
          <div class="stat-value">\${total}</div>
          <div class="stat-label">Total</div>
        </div>
        <div class="stat-card">
          <div class="stat-value success">\${found}</div>
          <div class="stat-label">Found</div>
        </div>
        <div class="stat-card">
          <div class="stat-value pending">\${pending}</div>
          <div class="stat-label">Pending</div>
        </div>
        <div class="stat-card">
          <div class="stat-value error">\${notFound}</div>
          <div class="stat-label">Not Found</div>
        </div>
      \`;
      
      // Table
      const tbody = document.getElementById('tableBody');
      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No data matching filter</td></tr>';
        return;
      }
      
      tbody.innerHTML = data.map(row => {
        const filename = row.slug + '.svg';
        const status = getRowStatus(row);
        return \`
          <tr>
            <td>
              \${row.found === 'True' ? \`<img class="preview-img" src="/svg/\${filename}" alt="\${row.slug}" onerror="this.style.display='none'">\` : '—'}
            </td>
            <td class="slug">\${row.slug}</td>
            <td>
              <a href="\${row.app_url}" target="_blank" class="url-link" title="\${row.app_url}">\${row.app_url}</a>
            </td>
            <td><span class="badge \${status.class}">\${status.label}</span></td>
            <td><span class="source-tag">\${row.source || '—'}</span></td>
            <td>
              <div class="pending-previews">
                \${renderPendingFiles(row.pending_files, row.slug)}
              </div>
            </td>
          </tr>
        \`;
      }).join('');
    }
    
    // Filter tab handlers
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;
        renderTable();
      });
    });
    
    loadProgress();
  </script>
</body>
</html>`;

const brokenHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Broken Logos Recovery</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'JetBrains Mono', 'SF Mono', Monaco, monospace; 
      background: #1a1a2e; 
      color: #eee; 
      min-height: 100vh; 
      padding: 24px;
    }
    
    .header { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #333;
    }
    
    h1 { 
      font-size: 20px; 
      font-weight: 500;
      color: #ff6b6b;
      letter-spacing: -0.5px;
    }
    h1 span { color: #888; font-weight: 400; }
    
    .header-actions {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    
    .nav-link {
      color: #888;
      text-decoration: none;
      font-size: 13px;
      padding: 6px 12px;
      border: 1px solid #444;
      border-radius: 6px;
      transition: all 0.15s;
    }
    .nav-link:hover { color: #eee; border-color: #666; }
    
    .run-btn {
      background: #ff6b6b;
      border: none;
      color: #fff;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s;
    }
    .run-btn:hover { background: #ff8585; }
    .run-btn:disabled { background: #444; cursor: not-allowed; }
    
    .stats {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    
    .stat-card {
      background: #16213e;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 16px 20px;
      min-width: 100px;
    }
    
    .stat-value {
      font-size: 32px;
      font-weight: 600;
      color: #ff6b6b;
    }
    .stat-value.success { color: #4ade80; }
    .stat-value.pending { color: #fbbf24; }
    .stat-value.waiting { color: #888; }
    
    .stat-label {
      font-size: 11px;
      color: #888;
      margin-top: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 16px;
    }
    
    .card {
      background: #16213e;
      border: 1px solid #333;
      border-radius: 8px;
      overflow: hidden;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: #555; }
    .card.found { border-color: #4ade80; }
    .card.pending { border-color: #fbbf24; }
    .card.notfound { border-color: #666; }
    
    .card-preview {
      height: 100px;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
    }
    .card-preview img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .card-preview.empty {
      background: #222;
      color: #555;
      font-size: 32px;
    }
    
    .card-info {
      padding: 12px;
    }
    
    .card-slug {
      font-size: 13px;
      font-weight: 500;
      color: #eee;
      margin-bottom: 4px;
      word-break: break-all;
    }
    
    .card-domain {
      font-size: 11px;
      color: #666;
      margin-bottom: 8px;
    }
    .card-domain a { color: #58a6ff; text-decoration: none; }
    .card-domain a:hover { text-decoration: underline; }
    
    .card-status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
    }
    .card-status.found { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
    .card-status.pending { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
    .card-status.waiting { background: rgba(136, 136, 136, 0.15); color: #888; }
    .card-status.notfound { background: rgba(248, 113, 113, 0.15); color: #f87171; }
    
    .card-source {
      font-size: 10px;
      color: #666;
      margin-left: 8px;
    }
    
    .pending-thumbs {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }
    .pending-thumb {
      width: 32px;
      height: 32px;
      background: #fff;
      border-radius: 4px;
      padding: 2px;
      cursor: pointer;
    }
    .pending-thumb img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    
    .vectorize-btn {
      background: #4ade80;
      border: none;
      color: #000;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 10px;
      cursor: pointer;
      margin-top: 8px;
      font-family: inherit;
    }
    .vectorize-btn:hover { background: #6ee7a0; }
    .vectorize-btn:disabled { background: #444; color: #888; cursor: not-allowed; }
    
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #4ade80;
      color: #000;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13px;
      opacity: 0;
      transition: opacity 0.3s;
      z-index: 1000;
    }
    .toast.error { background: #f87171; color: #fff; }
    .toast.show { opacity: 1; }
    
    .refresh-hint {
      font-size: 12px;
      color: #666;
      margin-left: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Broken Logos Recovery <span>/ 45 logos</span></h1>
    <div class="header-actions">
      <span class="refresh-hint">Auto-refreshes every 10s while running</span>
      <a href="/" class="nav-link">← SVG Viewer</a>
      <a href="/progress" class="nav-link">All Progress</a>
    </div>
  </div>
  
  <div class="stats" id="stats"></div>
  
  <div class="grid" id="grid"></div>
  
  <div class="toast" id="toast"></div>

  <script>
    let allData = [];
    let inputData = [];
    let refreshInterval = null;
    
    function showToast(msg, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.className = 'toast show' + (isError ? ' error' : '');
      setTimeout(() => toast.className = 'toast', 3000);
    }
    
    async function vectorize(pendingPath, slug) {
      const btn = event.target;
      btn.disabled = true;
      btn.textContent = 'Processing...';
      
      try {
        const res = await fetch('/api/vectorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pendingPath, slug })
        });
        
        if (res.ok) {
          showToast('Vectorized: ' + slug + '.svg');
          loadData();
        } else {
          const err = await res.text();
          showToast('Error: ' + err, true);
          btn.disabled = false;
          btn.textContent = 'Vectorize';
        }
      } catch (err) {
        showToast('Error: ' + err.message, true);
        btn.disabled = false;
        btn.textContent = 'Vectorize';
      }
    }
    
    function getStatus(progress) {
      if (!progress) return { label: 'Waiting', class: 'waiting' };
      if (progress.found === 'True') return { label: 'Found', class: 'found' };
      if (progress.pending_files && progress.pending_files.trim()) return { label: 'Pending', class: 'pending' };
      return { label: 'Not Found', class: 'notfound' };
    }

    async function loadData() {
      // Load input CSV (the 45 broken logos)
      const inputRes = await fetch('/api/broken-input');
      inputData = await inputRes.json();
      
      // Load progress CSV (results)
      const progressRes = await fetch('/api/broken-progress');
      const progressData = await progressRes.json();
      
      // Create lookup by slug
      const progressMap = {};
      progressData.forEach(p => progressMap[p.slug] = p);
      
      // Merge
      allData = inputData.map(input => ({
        ...input,
        progress: progressMap[input.slug] || null
      }));
      
      render();
    }
    
    function render() {
      // Stats
      const total = allData.length;
      const found = allData.filter(d => d.progress?.found === 'True').length;
      const pending = allData.filter(d => d.progress && d.progress.found !== 'True' && d.progress.pending_files?.trim()).length;
      const notFound = allData.filter(d => d.progress && d.progress.found !== 'True' && !d.progress.pending_files?.trim()).length;
      const waiting = total - found - pending - notFound;
      
      document.getElementById('stats').innerHTML = \`
        <div class="stat-card">
          <div class="stat-value">\${total}</div>
          <div class="stat-label">Total</div>
        </div>
        <div class="stat-card">
          <div class="stat-value success">\${found}</div>
          <div class="stat-label">Found</div>
        </div>
        <div class="stat-card">
          <div class="stat-value pending">\${pending}</div>
          <div class="stat-label">Pending Review</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:#f87171">\${notFound}</div>
          <div class="stat-label">Not Found</div>
        </div>
        <div class="stat-card">
          <div class="stat-value waiting">\${waiting}</div>
          <div class="stat-label">Waiting</div>
        </div>
      \`;
      
      // Grid
      const grid = document.getElementById('grid');
      grid.innerHTML = allData.map(d => {
        const status = getStatus(d.progress);
        const hasPreview = d.progress?.found === 'True';
        const pendingFiles = d.progress?.pending_files?.split(';').filter(f => f.trim()) || [];
        
        return \`
          <div class="card \${status.class}">
            <div class="card-preview \${hasPreview ? '' : 'empty'}">
              \${hasPreview 
                ? \`<img src="/svg/\${d.slug}.svg" alt="\${d.slug}" onerror="this.parentElement.classList.add('empty');this.remove();">\` 
                : '?'}
            </div>
            <div class="card-info">
              <div class="card-slug">\${d.slug}</div>
              <div class="card-domain"><a href="\${d.app_url}" target="_blank">\${d.domain}</a></div>
              <span class="card-status \${status.class}">\${status.label}</span>
              \${d.progress?.source ? \`<span class="card-source">\${d.progress.source}</span>\` : ''}
              \${pendingFiles.length > 0 ? \`
                <div class="pending-thumbs">
                  \${pendingFiles.map(f => {
                    const filename = f.split('/').pop();
                    return \`
                      <div class="pending-thumb" title="\${filename}">
                        <img src="/pending/\${filename}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22><text y=%2220%22>?</text></svg>'">
                      </div>
                    \`;
                  }).join('')}
                </div>
                <button class="vectorize-btn" onclick="vectorize('\${pendingFiles[0]}', '\${d.slug}')">Vectorize</button>
              \` : ''}
            </div>
          </div>
        \`;
      }).join('');
      
      // Auto-refresh if there are waiting items
      if (waiting > 0 && !refreshInterval) {
        refreshInterval = setInterval(loadData, 10000);
      } else if (waiting === 0 && refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
      }
    }
    
    loadData();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }
  
  if (url.pathname === '/progress') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(progressHtml);
    return;
  }
  
  if (url.pathname === '/broken') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(brokenHtml);
    return;
  }
  
  if (url.pathname === '/api/broken-input') {
    try {
      const content = fs.readFileSync(BROKEN_INPUT_CSV, 'utf8').replace(/\r/g, '');
      const lines = content.trim().split('\n');
      const headers = lines[0].split(',');
      const data = lines.slice(1).filter(l => l.trim()).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((h, i) => obj[h.trim()] = (values[i] || '').trim());
        return obj;
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }
  
  if (url.pathname === '/api/broken-progress') {
    try {
      const content = fs.readFileSync(BROKEN_PROGRESS_CSV, 'utf8').replace(/\r/g, '');
      const lines = content.trim().split('\n');
      const headers = lines[0].split(',');
      const data = lines.slice(1).filter(l => l.trim()).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((h, i) => obj[h.trim()] = (values[i] || '').trim());
        return obj;
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      // No progress yet - return empty array
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }
  
  if (url.pathname === '/api/progress') {
    try {
      const content = fs.readFileSync(PROGRESS_CSV, 'utf8').replace(/\r/g, '');
      const lines = content.trim().split('\n');
      const headers = lines[0].split(',');
      const data = lines.slice(1).filter(l => l.trim()).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((h, i) => obj[h.trim()] = (values[i] || '').trim());
        return obj;
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }
  
  if (url.pathname === '/api/list') {
    try {
      const files = fs.readdirSync(ASSETS_DIR)
        .filter(f => f.endsWith('.svg'))
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(files));
    } catch (err) {
      res.writeHead(500);
      res.end(err.message);
    }
    return;
  }
  
  // Fetch toolkit URLs from Composio API
  if (url.pathname === '/api/toolkit-urls') {
    try {
      const apiRes = await fetch(COMPOSIO_API_URL, {
        headers: { 'x-api-key': COMPOSIO_API_KEY }
      });
      const data = await apiRes.json();
      
      // Create slug → app_url mapping
      const urlMap = {};
      if (data.items) {
        data.items.forEach(toolkit => {
          urlMap[toolkit.slug] = toolkit.meta?.app_url || '';
        });
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(urlMap));
    } catch (err) {
      res.writeHead(500);
      res.end(err.message);
    }
    return;
  }
  
  // Detect white-only SVGs
  if (url.pathname === '/api/white-only') {
    try {
      const files = fs.readdirSync(ASSETS_DIR).filter(f => f.endsWith('.svg'));
      const whiteOnly = [];
      
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(ASSETS_DIR, file), 'utf8');
          if (isWhiteOnlySvg(content)) {
            whiteOnly.push(file);
          }
        } catch (e) {
          // Skip files that can't be read
        }
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(whiteOnly));
    } catch (err) {
      res.writeHead(500);
      res.end(err.message);
    }
    return;
  }
  
  if (url.pathname === '/api/replace' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name, content } = JSON.parse(body);
        const filepath = path.join(ASSETS_DIR, name);
        
        // Security check
        if (!filepath.startsWith(ASSETS_DIR) || !name.endsWith('.svg')) {
          res.writeHead(400);
          res.end('Invalid file');
          return;
        }
        
        // Validate it's valid SVG
        if (!content.includes('<svg') || !content.includes('</svg>')) {
          res.writeHead(400);
          res.end('Invalid SVG content');
          return;
        }
        
        fs.writeFileSync(filepath, content);
        console.log('[Replace] Updated:', name);
        res.writeHead(200);
        res.end('OK');
      } catch (err) {
        res.writeHead(500);
        res.end(err.message);
      }
    });
    return;
  }
  
  if (url.pathname === '/api/rename' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { oldName, newName } = JSON.parse(body);
        const oldPath = path.join(ASSETS_DIR, oldName);
        const newPath = path.join(ASSETS_DIR, newName);
        
        if (!fs.existsSync(oldPath)) {
          res.writeHead(404);
          res.end('File not found');
          return;
        }
        
        if (fs.existsSync(newPath)) {
          res.writeHead(409);
          res.end('File already exists');
          return;
        }
        
        fs.renameSync(oldPath, newPath);
        res.writeHead(200);
        res.end('OK');
      } catch (err) {
        res.writeHead(500);
        res.end(err.message);
      }
    });
    return;
  }
  
  if (url.pathname.startsWith('/svg/')) {
    const filename = decodeURIComponent(url.pathname.slice(5));
    const filepath = path.join(ASSETS_DIR, filename);
    
    if (!filepath.startsWith(ASSETS_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    
    try {
      const content = fs.readFileSync(filepath);
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(content);
    } catch (err) {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }
  
  // Serve pending files
  if (url.pathname.startsWith('/pending/')) {
    const filename = decodeURIComponent(url.pathname.slice(9));
    const filepath = path.join(PENDING_DIR, filename);
    
    if (!filepath.startsWith(PENDING_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    
    try {
      const content = fs.readFileSync(filepath);
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
        '.svg': 'image/svg+xml'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content);
    } catch (err) {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }
  
  // Vectorize a pending file and save to assets
  if (url.pathname === '/api/vectorize' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { pendingPath, slug } = JSON.parse(body);
        
        const filename = path.basename(pendingPath);
        const ext = path.extname(filename).toLowerCase();
        const svgPath = path.join(ASSETS_DIR, slug + '.svg');
        
        // Extract source from filename (e.g., "slug_brandfetch.png" → "brandfetch")
        const sourceMatch = filename.match(/_(brandfetch|firecrawl)\./);
        const source = sourceMatch ? sourceMatch[1] : 'manual';
        
        // Helper: update progress CSV after successful vectorization
        function updateProgressCsv(slug, svgPath, source, wasVectorized, processedPendingPath) {
          try {
            const content = fs.readFileSync(PROGRESS_CSV, 'utf8').replace(/\r/g, '');
            const lines = content.trim().split('\n');
            const headers = lines[0].split(',').map(h => h.trim());
            
            const updatedLines = [lines[0]]; // keep header
            
            for (let i = 1; i < lines.length; i++) {
              const values = lines[i].split(',');
              const rowSlug = values[0]?.trim();
              
              if (rowSlug === slug) {
                // Update this row
                const row = {};
                headers.forEach((h, idx) => row[h] = (values[idx] || '').trim());
                
                row.found = 'True';
                row.local_path = svgPath;
                row.source = source;
                row.vectorized = wasVectorized ? 'True' : 'False';
                
                // Remove processed file from pending_files list
                if (row.pending_files) {
                  const pendingList = row.pending_files.split(';').filter(p => p.trim() && p.trim() !== processedPendingPath);
                  row.pending_files = pendingList.join(';');
                }
                
                // Rebuild row
                const newValues = headers.map(h => row[h] || '');
                updatedLines.push(newValues.join(','));
              } else {
                updatedLines.push(lines[i]);
              }
            }
            
            fs.writeFileSync(PROGRESS_CSV, updatedLines.join('\n') + '\n');
            console.log('[Vectorize] Updated progress CSV for:', slug);
          } catch (e) {
            console.log('[Vectorize] Failed to update CSV:', e.message);
          }
        }
        
        console.log('[Vectorize] Processing:', filename, 'for slug:', slug);
        
        // Helper: fix white-only SVGs
        function fixWhiteSvg(svgContent) {
          let result = svgContent;
          // Replace white fills with black
          result = result.replace(
            /(fill\s*[=:]\s*["']?\s*)(#fff(?:fff)?|white|rgb\s*\(\s*255\s*,\s*255\s*,\s*255\s*\))/gi,
            '$1#000000'
          );
          // Replace white strokes with black
          result = result.replace(
            /(stroke\s*[=:]\s*["']?\s*)(#fff(?:fff)?|white|rgb\s*\(\s*255\s*,\s*255\s*,\s*255\s*\))/gi,
            '$1#000000'
          );
          // If no fill specified, add fill="currentColor" to svg root
          if (!result.toLowerCase().includes('fill') || result === svgContent) {
            result = result.replace(/<svg\b/i, '<svg fill="currentColor"');
          }
          return result;
        }
        
        // Check if white-only SVG
        function isWhiteSvg(svgContent) {
          const lower = svgContent.toLowerCase();
          const whitePatterns = [
            /fill\s*[=:]\s*["']?\s*(#fff|#ffffff|white|rgb\s*\(\s*255\s*,\s*255\s*,\s*255\s*\))/i,
            /stroke\s*[=:]\s*["']?\s*(#fff|#ffffff|white|rgb\s*\(\s*255\s*,\s*255\s*,\s*255\s*\))/i
          ];
          for (const pattern of whitePatterns) {
            if (pattern.test(lower)) return true;
          }
          const hasShapes = ['<path', '<rect', '<circle', '<polygon', '<ellipse'].some(t => lower.includes(t));
          const hasFill = lower.includes('fill');
          if (hasShapes && !hasFill) return true;
          return false;
        }
        
        // If already SVG → just copy (no vectorization needed)
        if (ext === '.svg') {
          let svgContent = fs.readFileSync(pendingPath, 'utf8');
          
          // Fix white SVGs
          if (isWhiteSvg(svgContent)) {
            console.log('[Vectorize] Fixing white SVG...');
            svgContent = fixWhiteSvg(svgContent);
          }
          
          fs.writeFileSync(svgPath, svgContent);
          console.log('[Vectorize] Copied SVG:', svgPath);
          
          // Update progress CSV (SVG copy = not vectorized)
          updateProgressCsv(slug, svgPath, source, false, pendingPath);
          
          res.writeHead(200);
          res.end('OK');
          return;
        }
        
        // Raster image → call Vectorizer.ai API
        let imgData = fs.readFileSync(pendingPath);
        let uploadFilename = filename;
        let mimeType;
        
        const mimeTypes = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp'
        };
        
        // ICO files need conversion to PNG (Vectorizer.ai doesn't support ICO)
        if (ext === '.ico') {
          console.log('[Vectorize] Converting ICO to PNG...');
          
          // Try icojs first (handles both BMP and PNG ICOs)
          if (icojs) {
            try {
              const images = await icojs.parseICO(imgData);
              if (images.length === 0) {
                throw new Error('No images found in ICO');
              }
              // Get the largest image
              const largest = images.reduce((a, b) => (a.width * a.height > b.width * b.height) ? a : b);
              console.log('[Vectorize] ICO decoded:', largest.width, 'x', largest.height, 'buffer:', largest.buffer.byteLength, 'bytes');
              
              // icojs returns PNG-encoded buffer, use directly with sharp
              imgData = Buffer.from(largest.buffer);
              uploadFilename = filename.replace('.ico', '.png');
              mimeType = 'image/png';
              console.log('[Vectorize] ICO converted to PNG via icojs');
            } catch (e) {
              console.log('[Vectorize] icojs conversion failed:', e.message);
              res.writeHead(400);
              res.end('ICO conversion failed: ' + e.message);
              return;
            }
          } else if (sharp) {
            // Fallback: try sharp directly (works for PNG-embedded ICOs)
            try {
              imgData = await sharp(imgData).png().toBuffer();
              uploadFilename = filename.replace('.ico', '.png');
              mimeType = 'image/png';
              console.log('[Vectorize] ICO converted to PNG via sharp');
            } catch (e) {
              console.log('[Vectorize] sharp conversion failed:', e.message);
              res.writeHead(400);
              res.end('ICO conversion failed: ' + e.message);
              return;
            }
          } else {
            res.writeHead(400);
            res.end('ICO format not supported. Install icojs: bun add icojs');
            return;
          }
        } else {
          mimeType = mimeTypes[ext] || 'application/octet-stream';
        }
        
        const formData = new FormData();
        const blob = new Blob([imgData], { type: mimeType });
        formData.append('image', blob, uploadFilename);
        
        const authString = Buffer.from(VECTORIZER_API_KEY + ':' + VECTORIZER_API_SECRET).toString('base64');
        
        console.log('[Vectorize] Calling Vectorizer.ai for raster:', filename);
        
        const apiRes = await fetch('https://vectorizer.ai/api/v1/vectorize', {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + authString
          },
          body: formData
        });
        
        if (apiRes.ok) {
          const svgContent = await apiRes.text();
          
          fs.writeFileSync(svgPath, svgContent);
          console.log('[Vectorize] Saved:', svgPath);
          
          // Update progress CSV (raster → SVG = vectorized)
          updateProgressCsv(slug, svgPath, source, true, pendingPath);
          
          res.writeHead(200);
          res.end('OK');
        } else {
          const errText = await apiRes.text();
          console.log('[Vectorize] API error:', apiRes.status, errText);
          res.writeHead(apiRes.status);
          res.end('Vectorizer API error: ' + errText);
        }
      } catch (err) {
        console.log('[Vectorize] Error:', err.message);
        res.writeHead(500);
        res.end(err.message);
      }
    });
    return;
  }
  
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🖼️  SVG Viewer running at http://localhost:${PORT}`);
  console.log(`   Assets: ${ASSETS_DIR}`);
  console.log(`   Temp:   ${TEMP_DIR}\n`);
});
