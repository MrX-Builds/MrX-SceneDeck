/*
  MrX SceneDeck v2.1.2 - Stash UI plugin.
  Shows selectable 4x4 through 8x8 sprite sheets immediately, then upgrades
  them with independently generated and cached high-resolution sheets.
  Does not change Stash metadata or modify Mosaic Poster.
  Requires Chrome/Edge Document Picture-in-Picture (localhost or HTTPS).

  Auto-open on the first player gesture was suggested by the Mosaic Poster
  developer. This implementation is original. Auto-open is enabled by default;
  it can be disabled without making the button-free floater unreachable.
*/
(function () {
  'use strict';
  if (window.top !== window.self) return;

  const DEFAULT_GRID = 6;
  const GRID_OPTIONS = [4, 5, 6, 7, 8];
  const GRID_STORAGE_KEY = 'MrXSceneDeck.grid';
  const LEGACY_GRID_STORAGE_KEY = 'MosaicFloat6x6.grid';
  const KEYBOARD_SEEK_SECONDS = 5;
  const PLUGIN_ID = 'MrXSceneDeck';
  const STASH_BASE_URL = (() => {
    try {
      const baseElement = document.querySelector('base[href]');
      const baseValue = baseElement && baseElement.getAttribute('href');
      const base = new URL(baseValue || '/', window.location.href);
      if (!base.pathname.endsWith('/')) base.pathname += '/';
      return base;
    } catch (_) {
      return new URL('/', window.location.href);
    }
  })();
  let pipWindow = null;
  let pipUi = null;
  let openingPip = false;
  let autoOpenEnabled = true;
  let highResEnabled = true;
  let autoOpenConfigLoaded = false;
  let autoOpenConsumed = false;
  let lastSceneId = null;
  let lastFloatingGrid = null;
  let activeSceneId = null;
  let activeTimes = [];
  let activeDuration = 0;
  let activeHighRes = false;
  let selectedCellIndex = 0;
  let ctrlNavigationActive = false;
  let ctrlNavigationMoved = false;
  let renderSerial = 0;
  const sceneInfoCache = new Map();
  const sheetCache = new Map();
  const highResReady = new Set();
  const highResProbeCache = new Map();
  const highResGenerationCache = new Map();
  let floatingGrid = (() => {
    try {
      const savedValue = localStorage.getItem(GRID_STORAGE_KEY) ??
        localStorage.getItem(LEGACY_GRID_STORAGE_KEY);
      const saved = Number(savedValue);
      return GRID_OPTIONS.includes(saved) ? saved : DEFAULT_GRID;
    } catch (_) {
      return DEFAULT_GRID;
    }
  })();

  function stashUrl(path) {
    return new URL(String(path || '').replace(/^\/+/, ''), STASH_BASE_URL).toString();
  }

  function stashResourceUrl(value) {
    if (!value) return value;
    const text = String(value);
    try {
      if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith('//')) {
        return new URL(text, window.location.href).toString();
      }
      const basePath = STASH_BASE_URL.pathname.replace(/\/+$/, '');
      if (text.startsWith('/') && basePath &&
          (text === basePath || text.startsWith(basePath + '/'))) {
        return new URL(text, window.location.origin).toString();
      }
      return stashUrl(text);
    } catch (_) {
      return text;
    }
  }

  function stashRelativePath() {
    const basePath = STASH_BASE_URL.pathname.replace(/\/+$/, '');
    const pathname = window.location.pathname;
    if (basePath && pathname === basePath) return '/';
    if (basePath && pathname.startsWith(basePath + '/')) {
      return pathname.slice(basePath.length);
    }
    return pathname;
  }

  function sceneId() {
    const match = stashRelativePath().match(/^\/scenes\/(\d+)(?:\/|$)/);
    return match ? match[1] : null;
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return hours
      ? [hours, minutes, secs].map(v => String(v).padStart(2, '0')).join(':')
      : [minutes, secs].map(v => String(v).padStart(2, '0')).join(':');
  }

  function activeStatus(extra) {
    if (!activeSceneId) return 'Waiting ...';
    return 'Scene #' + activeSceneId + '  |  ' + floatingGrid + '×' + floatingGrid +
      '  |  ' + (activeHighRes ? 'High-res' : 'Sprite') +
      (extra ? '  |  ' + extra : '  |  Click, Ctrl+Arrows, or Left/Right Arrow');
  }

  // Same approach Mosaic Poster uses: seek the Video.js player (or HTML video).
  function seekTo(seconds) {
    if (!Number.isFinite(seconds)) return;
    try {
      const root = document.querySelector('.video-js');
      if (window.videojs && root) {
        const player = window.videojs.getPlayer
          ? window.videojs.getPlayer(root)
          : window.videojs(root);
        if (player) {
          const seek = () => { try { player.currentTime(seconds); } catch (_) {} };
          const playing = player.play();
          if (playing && playing.then) playing.then(seek, seek);
          player.one('loadedmetadata', seek);
          player.one('playing', seek);
          return;
        }
      }
    } catch (_) { /* use HTML video below */ }

    const video = document.querySelector('video.vjs-tech') || document.querySelector('.video-js video');
    if (!video) return;
    const seek = () => { try { video.currentTime = seconds; } catch (_) {} };
    try {
      const playing = video.play();
      if (playing && playing.then) playing.then(seek, seek);
    } catch (_) { /* seeking can still work */ }
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
  }

  // Seek without changing play/pause state. This lets the floating window
  // handle Left/Right Arrow itself, so focus never needs to return to Stash.
  function seekBy(delta) {
    if (!Number.isFinite(delta)) return null;
    try {
      const root = document.querySelector('.video-js');
      if (window.videojs && root) {
        const player = window.videojs.getPlayer
          ? window.videojs.getPlayer(root)
          : window.videojs(root);
        if (player) {
          const current = Number(player.currentTime());
          const duration = Number(player.duration());
          if (Number.isFinite(current)) {
            const target = Math.max(0, Number.isFinite(duration)
              ? Math.min(duration, current + delta)
              : current + delta);
            player.currentTime(target);
            return target;
          }
        }
      }
    } catch (_) { /* use HTML video below */ }

    const video = document.querySelector('video.vjs-tech') || document.querySelector('.video-js video');
    if (!video || !Number.isFinite(video.currentTime)) return null;
    const duration = Number(video.duration);
    const target = Math.max(0, Number.isFinite(duration)
      ? Math.min(duration, video.currentTime + delta)
      : video.currentTime + delta);
    try {
      video.currentTime = target;
      return target;
    } catch (_) {
      return null;
    }
  }

  function currentPlaybackTime() {
    try {
      const root = document.querySelector('.video-js');
      if (window.videojs && root) {
        const player = window.videojs.getPlayer
          ? window.videojs.getPlayer(root)
          : window.videojs(root);
        const current = player && Number(player.currentTime());
        if (Number.isFinite(current)) return current;
      }
    } catch (_) { /* use HTML video below */ }
    const video = document.querySelector('video.vjs-tech') || document.querySelector('.video-js video');
    return video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
  }

  function createUi(win) {
    const doc = win.document;
    doc.title = 'MrX SceneDeck';
    const style = doc.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; }
      html,body { margin:0; padding:0; width:100%; height:100%; background:#080b10; color:#fff; }
      body { display:flex; flex-direction:column; font-family:system-ui,-apple-system,Segoe UI,sans-serif; }
      .bar { flex:0 0 43px; display:flex; align-items:center; gap:12px;
             padding:0 12px; background:#141c27; border-bottom:1px solid #303e50; }
      .heading { font-weight:650; font-size:13px; white-space:nowrap; }
      .grid-switch { display:flex; gap:3px; padding:2px; border:1px solid #384a60;
                     border-radius:6px; background:#0b1119; }
      .grid-option { padding:3px 7px; border:0; border-radius:4px; cursor:pointer;
                     background:transparent; color:#aebfd3; font:600 11px system-ui,sans-serif; }
      .grid-option:hover,.grid-option:focus-visible { color:#fff; background:#2b3a4d; outline:none; }
      .grid-option.active { color:#07101b; background:#acd9ff; }
      .status { font-size:12px; color:#aebfd3; flex:1; overflow:hidden;
                white-space:nowrap; text-overflow:ellipsis; text-align:right; }
      .viewport { flex:1; min-height:0; min-width:0; display:flex; position:relative;
                  align-items:center; justify-content:center; overflow:hidden; }
      .sheet { position:relative; display:none; overflow:hidden; background:#000; }
      .sheet img { width:100%; height:100%; display:block; }
      .cells { position:absolute; inset:0; display:grid; }
      .cells button { min-width:0; min-height:0; cursor:pointer; outline:none;
                      padding:0; border:1px solid #ffffff1e; background:transparent; }
      .cells button:hover,.cells button:focus-visible {
             border:2px solid #acd9ff; background:#a0cfff24; z-index:1; }
      .cells button.keyboard-selected {
             border:3px solid #ffd36a; background:#ffd36a35; z-index:2;
             box-shadow:inset 0 0 0 1px #111; }
      .notice { padding:24px; max-width:560px; text-align:center; color:#d9e4ee;
                font-size:14px; line-height:1.5; white-space:pre-line; }
    `;
    doc.head.appendChild(style);

    const bar = doc.createElement('div');
    bar.className = 'bar';
    const heading = doc.createElement('span');
    heading.className = 'heading';
    heading.textContent = 'MrX SceneDeck';
    const gridSwitch = doc.createElement('div');
    gridSwitch.className = 'grid-switch';
    gridSwitch.setAttribute('role', 'group');
    gridSwitch.setAttribute('aria-label', 'MrX SceneDeck grid size');
    const gridButtons = new Map();
    GRID_OPTIONS.forEach(size => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'grid-option';
      button.textContent = size + '×' + size;
      button.title = 'Show ' + size + '×' + size + ' floating grid';
      button.addEventListener('click', () => setFloatingGrid(size));
      gridButtons.set(size, button);
      gridSwitch.appendChild(button);
    });
    const status = doc.createElement('span');
    status.className = 'status';
    status.textContent = 'Loading ...';
    bar.append(heading, gridSwitch, status);

    const viewport = doc.createElement('div');
    viewport.className = 'viewport';
    const notice = doc.createElement('div');
    notice.className = 'notice';
    notice.textContent = 'Waiting for Stash sprite data ...';
    const sheet = doc.createElement('div');
    sheet.className = 'sheet';
    const image = doc.createElement('img');
    image.alt = 'MrX SceneDeck contact sheet';
    image.draggable = false;
    const cells = doc.createElement('div');
    cells.className = 'cells';

    const maxGrid = GRID_OPTIONS[GRID_OPTIONS.length - 1];
    for (let i = 0; i < maxGrid * maxGrid; i++) {
      const cell = doc.createElement('button');
      cell.type = 'button';
      cell.title = 'Seek to frame ' + (i + 1);
      cell.setAttribute('aria-label', cell.title);
      cell.addEventListener('mouseenter', () => {
        if (activeSceneId && !ctrlNavigationActive) {
          status.textContent = 'Frame ' + (i + 1) + '  |  ' + formatTime(activeTimes[i]);
        }
      });
      cell.addEventListener('mouseleave', () => {
        if (ctrlNavigationActive) return;
        status.textContent = activeStatus();
      });
      cell.addEventListener('click', () => {
        if (!activeSceneId || activeSceneId !== sceneId()) return;
        selectedCellIndex = i;
        updateCellSelection();
        seekTo(activeTimes[i]);
      });
      cells.appendChild(cell);
    }
    sheet.append(image, cells);
    viewport.append(notice, sheet);
    doc.body.append(bar, viewport);

    // Clicking a mosaic cell leaves keyboard focus in the floating document.
    // Handle seeking here rather than forcing focus back to the main window,
    // which could turn the player's focus-restoring click into pause/play.
    win.addEventListener('keydown', event => {
      if (!activeSceneId || activeSceneId !== sceneId()) return;

      const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (event.key === 'Control') {
        ctrlNavigationActive = true;
        ctrlNavigationMoved = false;
        selectedCellIndex = nearestActiveCell();
        updateCellSelection();
        status.textContent = 'Ctrl navigation  |  Use arrows, release Ctrl to play';
        return;
      }

      if (event.ctrlKey && arrows.includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (!ctrlNavigationActive) {
          ctrlNavigationActive = true;
          ctrlNavigationMoved = false;
          selectedCellIndex = nearestActiveCell();
        }
        const row = Math.floor(selectedCellIndex / floatingGrid);
        const column = selectedCellIndex % floatingGrid;
        let nextRow = row;
        let nextColumn = column;
        if (event.key === 'ArrowLeft') nextColumn--;
        if (event.key === 'ArrowRight') nextColumn++;
        if (event.key === 'ArrowUp') nextRow--;
        if (event.key === 'ArrowDown') nextRow++;
        nextRow = Math.max(0, Math.min(floatingGrid - 1, nextRow));
        nextColumn = Math.max(0, Math.min(floatingGrid - 1, nextColumn));
        const nextIndex = nextRow * floatingGrid + nextColumn;
        if (nextIndex !== selectedCellIndex) {
          selectedCellIndex = nextIndex;
          ctrlNavigationMoved = true;
        }
        updateCellSelection();
        status.textContent = 'Selected frame ' + (selectedCellIndex + 1) + '  |  ' +
          formatTime(activeTimes[selectedCellIndex]) + '  |  Release Ctrl to play';
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === 'ArrowLeft' ? -KEYBOARD_SEEK_SECONDS : KEYBOARD_SEEK_SECONDS;
        const target = seekBy(delta);
        if (Number.isFinite(target)) {
          status.textContent = (delta < 0 ? 'Back ' : 'Forward ') +
            KEYBOARD_SEEK_SECONDS + 's  |  ' + formatTime(target);
        }
      }
    });

    win.addEventListener('keyup', event => {
      if (event.key !== 'Control' || !ctrlNavigationActive) return;
      const shouldPlay = ctrlNavigationMoved && activeSceneId && activeSceneId === sceneId() &&
        Number.isFinite(activeTimes[selectedCellIndex]);
      ctrlNavigationActive = false;
      ctrlNavigationMoved = false;
      if (shouldPlay) {
        const time = activeTimes[selectedCellIndex];
        seekTo(time);
        status.textContent = 'Playing frame ' + (selectedCellIndex + 1) + '  |  ' + formatTime(time);
      } else if (activeSceneId) {
        status.textContent = 'Scene #' + activeSceneId + '  |  ' + floatingGrid + '×' + floatingGrid;
      }
    });

    win.addEventListener('blur', () => {
      ctrlNavigationActive = false;
      ctrlNavigationMoved = false;
    });

    const resize = () => {
      if (sheet.style.display === 'none') return;
      const width = viewport.clientWidth - 8;
      const height = viewport.clientHeight - 8;
      const aspect = Number(sheet.dataset.aspect) || (16 / 9);
      if (width <= 0 || height <= 0) return;
      const drawWidth = Math.min(width, height * aspect);
      sheet.style.width = Math.max(1, drawWidth) + 'px';
      sheet.style.height = Math.max(1, drawWidth / aspect) + 'px';
    };
    if (win.ResizeObserver) {
      const ro = new win.ResizeObserver(resize);
      ro.observe(viewport);
    }
    win.addEventListener('resize', resize);
    return { heading, status, gridButtons, viewport, notice, sheet, image, cells, resize };
  }

  function nearestActiveCell() {
    if (!activeTimes.length) return 0;
    const current = currentPlaybackTime();
    let nearest = 0;
    let distance = Infinity;
    activeTimes.forEach((time, index) => {
      const candidate = Math.abs(Number(time) - current);
      if (candidate < distance) {
        nearest = index;
        distance = candidate;
      }
    });
    return nearest;
  }

  function updateCellSelection() {
    if (!pipUi) return;
    Array.from(pipUi.cells.children).forEach((cell, index) => {
      const selected = index === selectedCellIndex && index < activeTimes.length;
      cell.classList.toggle('keyboard-selected', selected);
      if (selected) cell.setAttribute('aria-current', 'true');
      else cell.removeAttribute('aria-current');
    });
  }

  function updateGridControls() {
    if (!pipUi) return;
    pipUi.gridButtons.forEach((button, size) => {
      const active = size === floatingGrid;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setFloatingGrid(size) {
    if (!GRID_OPTIONS.includes(size) || size === floatingGrid) return;
    floatingGrid = size;
    ctrlNavigationActive = false;
    ctrlNavigationMoved = false;
    selectedCellIndex = 0;
    activeHighRes = false;
    try { localStorage.setItem(GRID_STORAGE_KEY, String(size)); } catch (_) {}
    lastFloatingGrid = null;
    updateGridControls();
    if (pipUi) pipUi.status.textContent = 'Building ' + size + '×' + size + ' view ...';
    refreshFloatingGrid();
  }

  function fetchSceneInfo(id) {
    if (sceneInfoCache.has(id)) return sceneInfoCache.get(id);
    const request = fetch(stashUrl('graphql'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query MrXSceneDeckScene($id: ID!) { findScene(id: $id) { paths { sprite } files { duration fingerprints { type value } } } }',
        variables: { id }
      })
    }).then(response => {
      if (!response.ok) throw new Error('GraphQL HTTP ' + response.status);
      return response.json();
    }).then(payload => {
      if (payload.errors && payload.errors.length) {
        throw new Error(payload.errors.map(item => item.message).join('; '));
      }
      const scene = payload.data && payload.data.findScene;
      const firstFile = scene && scene.files && scene.files[0];
      const fingerprints = firstFile && firstFile.fingerprints || [];
      const oshashEntry = fingerprints.find(item => item && item.type === 'oshash');
      const cacheKey = String(oshashEntry && oshashEntry.value || 'scene-' + id)
        .replace(/[^A-Za-z0-9._-]/g, '_');
      return scene ? {
        sprite: stashResourceUrl(scene.paths && scene.paths.sprite),
        duration: Number(firstFile && firstFile.duration) || 0,
        cacheKey
      } : null;
    }).catch(error => {
      sceneInfoCache.delete(id);
      throw error;
    });
    sceneInfoCache.set(id, request);
    return request;
  }

  function vttSeconds(value) {
    return String(value).trim().split(':').reduce((total, part) =>
      total * 60 + (parseFloat(part) || 0), 0
    );
  }

  function fetchSpriteCues(spriteUrl) {
    const vttUrl = spriteUrl.replace(/_sprite\.jpg(?=($|\?))/, '_thumbs.vtt');
    return fetch(vttUrl, { credentials: 'same-origin' }).then(response => {
      if (!response.ok) throw new Error('Sprite VTT HTTP ' + response.status);
      return response.text();
    }).then(text => {
      const cues = [];
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const arrow = lines[i].indexOf('-->');
        if (arrow < 0) continue;
        const time = vttSeconds(lines[i].slice(0, arrow));
        for (let j = i + 1; j < lines.length && !lines[j].includes('-->'); j++) {
          const match = lines[j].match(/#xywh=(\d+),(\d+),(\d+),(\d+)/);
          if (match) {
            cues.push({ time, x: +match[1], y: +match[2], width: +match[3], height: +match[4] });
            break;
          }
        }
      }
      if (!cues.length) throw new Error('Sprite VTT contains no thumbnail cues');
      return cues;
    });
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load the Stash sprite image'));
      image.src = url;
    });
  }

  function highResSheetKey(cacheKey, size) {
    return cacheKey + '_' + size + 'x' + size;
  }

  function highResAssetUrl(cacheKey, size) {
    return stashUrl('plugin/' + PLUGIN_ID + '/assets/generated/' +
      highResSheetKey(cacheKey, size) + '.jpg');
  }

  function runPluginOperation(args) {
    return fetch(stashUrl('graphql'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'mutation MrXSceneDeckGenerate($id: ID!, $args: Map) { runPluginOperation(plugin_id: $id, args: $args) }',
        variables: { id: PLUGIN_ID, args }
      })
    }).then(response => {
      if (!response.ok) throw new Error('High-res GraphQL HTTP ' + response.status);
      return response.json();
    }).then(payload => {
      if (payload.errors && payload.errors.length) {
        throw new Error(payload.errors.map(item => item.message).join('; '));
      }
      return payload && payload.data && payload.data.runPluginOperation;
    });
  }

  function probeHighRes(cacheKey, size) {
    if (!cacheKey) return Promise.resolve(null);
    const key = highResSheetKey(cacheKey, size);
    const url = highResAssetUrl(cacheKey, size);
    if (highResReady.has(key)) return Promise.resolve(url);
    if (highResProbeCache.has(key)) return highResProbeCache.get(key);
    const probe = loadImage(url + '?probe=' + Date.now()).then(() => {
      highResReady.add(key);
      return url;
    }).catch(() => {
      highResProbeCache.delete(key);
      return null;
    });
    highResProbeCache.set(key, probe);
    return probe;
  }

  function generateHighRes(id, cacheKey, size) {
    const key = highResSheetKey(cacheKey, size);
    if (highResReady.has(key)) return Promise.resolve(highResAssetUrl(cacheKey, size));
    if (highResGenerationCache.has(key)) return highResGenerationCache.get(key);
    const baseUrl = highResAssetUrl(cacheKey, size);
    const generation = runPluginOperation({ mode: 'generate', scene_id: id, n: size })
      .then(output => {
        if (!output || output.ready !== true) {
          throw new Error('High-resolution generator did not return a completed sheet');
        }
        const freshUrl = baseUrl + '?generated=' + Date.now();
        return loadImage(freshUrl).then(() => {
          highResReady.add(key);
          return freshUrl;
        });
      }).then(result => {
        highResGenerationCache.delete(key);
        return result;
      }, error => {
        highResGenerationCache.delete(key);
        throw error;
      });
    highResGenerationCache.set(key, generation);
    return generation;
  }

  function ensureHighRes(id, cacheKey, size) {
    return probeHighRes(cacheKey, size).then(url =>
      url || generateHighRes(id, cacheKey, size)
    );
  }

  function pickIndices(sourceCount, targetCount) {
    if (sourceCount <= 0 || targetCount <= 0) return [];
    if (targetCount === 1) return [0];
    return Array.from({ length: targetCount }, (_, i) =>
      Math.round(i * (sourceCount - 1) / (targetCount - 1))
    );
  }

  // Build each selected grid directly from Stash's sprite/VTT. This is based
  // on the same public data source used by Mosaic Poster, but is implemented
  // independently and never changes Mosaic Poster's controls or settings.
  function buildGridSheet(spriteUrl, size) {
    const cacheKey = spriteUrl + '|' + size;
    if (sheetCache.has(cacheKey)) return sheetCache.get(cacheKey);
    const build = Promise.all([fetchSpriteCues(spriteUrl), loadImage(spriteUrl)]).then(([cues, sprite]) => {
      const indices = pickIndices(cues.length, size * size);
      const cellWidth = cues[0].width;
      const cellHeight = cues[0].height;
      const canvas = document.createElement('canvas');
      canvas.width = size * cellWidth;
      canvas.height = size * cellHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D context is unavailable');
      context.fillStyle = '#000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const times = [];
      indices.forEach((sourceIndex, targetIndex) => {
        const cue = cues[sourceIndex];
        context.drawImage(sprite, cue.x, cue.y, cue.width, cue.height,
          (targetIndex % size) * cellWidth, Math.floor(targetIndex / size) * cellHeight,
          cellWidth, cellHeight);
        times.push(cue.time);
      });
      return {
        url: canvas.toDataURL('image/jpeg', 0.88),
        times,
        aspect: cellWidth / cellHeight
      };
    }).catch(error => {
      sheetCache.delete(cacheKey);
      throw error;
    });
    sheetCache.set(cacheKey, build);
    return build;
  }

  function showNotice(message, id) {
    if (!pipUi) return;
    renderSerial++;
    activeSceneId = null;
    activeTimes = [];
    activeHighRes = false;
    selectedCellIndex = 0;
    ctrlNavigationActive = false;
    ctrlNavigationMoved = false;
    lastFloatingGrid = null;
    lastSceneId = id || null;
    pipUi.sheet.style.display = 'none';
    pipUi.notice.style.display = 'block';
    pipUi.notice.textContent = message;
    pipUi.status.textContent = id ? 'Scene #' + id : 'No scene';
  }

  function updateVisibleCells(size) {
    if (!pipUi) return;
    Array.from(pipUi.cells.children).forEach((cell, index) => {
      const visible = index < size * size;
      cell.style.display = visible ? 'block' : 'none';
      if (!visible) return;
      cell.title = 'Frame ' + (index + 1) + ' at ' + formatTime(activeTimes[index]);
      cell.setAttribute('aria-label', cell.title);
    });
  }

  function refreshFloatingGrid() {
    if (!pipWindow || pipWindow.closed || !pipUi) return;
    const id = sceneId();
    if (!id) {
      if (activeSceneId || lastSceneId !== null) showNotice('Open a Stash scene to display its contact sheet.', null);
      return;
    }

    if (lastSceneId === id && lastFloatingGrid === floatingGrid && activeSceneId === id) return;
    if (lastSceneId && lastSceneId !== id) sheetCache.clear();
    const targetGrid = floatingGrid;
    const serial = ++renderSerial;
    activeSceneId = null;
    activeHighRes = false;
    lastSceneId = id;
    lastFloatingGrid = targetGrid;
    updateGridControls();
    pipUi.status.textContent = 'Building ' + targetGrid + '×' + targetGrid + ' view ...';

    fetchSceneInfo(id).then(info => {
      if (!info || !info.sprite) {
        throw new Error('No Stash sprite is available for this scene');
      }
      return buildGridSheet(info.sprite, targetGrid).then(result => ({ result, info }));
    }).then(({ result, info }) => {
      if (serial !== renderSerial || !pipUi || !pipWindow || pipWindow.closed) return;
      if (sceneId() !== id || floatingGrid !== targetGrid) return;
      activeTimes = result.times;
      activeDuration = info.duration;
      activeSceneId = id;
      activeHighRes = false;
      selectedCellIndex = nearestActiveCell();
      pipUi.image.src = result.url;
      pipUi.image.alt = targetGrid + '×' + targetGrid + ' sprite contact sheet';
      pipUi.sheet.dataset.aspect = String(result.aspect || 16 / 9);
      pipUi.cells.style.gridTemplateColumns = 'repeat(' + targetGrid + ',minmax(0,1fr))';
      pipUi.cells.style.gridTemplateRows = 'repeat(' + targetGrid + ',minmax(0,1fr))';
      pipUi.notice.style.display = 'none';
      pipUi.sheet.style.display = 'block';
      updateVisibleCells(targetGrid);
      updateCellSelection();
      pipUi.resize();

      if (!highResEnabled) {
        pipUi.status.textContent = activeStatus();
        return;
      }
      pipUi.status.textContent = activeStatus('Generating high-res ...');
      void ensureHighRes(id, info.cacheKey, targetGrid).then(url => {
        if (serial !== renderSerial || !url || !pipUi || !pipWindow || pipWindow.closed) return;
        if (sceneId() !== id || floatingGrid !== targetGrid || activeSceneId !== id) return;
        const count = targetGrid * targetGrid;
        activeTimes = Array.from({ length: count }, (_, index) =>
          activeDuration * (index + 0.5) / count
        );
        activeHighRes = true;
        selectedCellIndex = nearestActiveCell();
        pipUi.image.src = url;
        pipUi.image.alt = targetGrid + '×' + targetGrid + ' high-resolution contact sheet';
        updateVisibleCells(targetGrid);
        updateCellSelection();
        pipUi.status.textContent = activeStatus();
      }).catch(error => {
        if (serial !== renderSerial || !pipUi || sceneId() !== id || floatingGrid !== targetGrid) return;
        console.warn('[MrX SceneDeck] High-resolution upgrade unavailable:', error);
        pipUi.status.textContent = activeStatus('High-res unavailable');
      });
    }).catch(error => {
      if (serial !== renderSerial) return;
      console.error('[MrX SceneDeck] Could not build selected grid:', error);
      showNotice(
        'Waiting for Stash sprite data.\n\n' +
        'Run Generate → Sprites for this scene, then reopen or reload the scene.', id
      );
    });
  }

  async function openFloatingWindow(trigger) {
    if (!sceneId()) return;
    if (pipWindow && !pipWindow.closed) {
      refreshFloatingGrid();
      if (trigger !== 'auto') pipWindow.focus();
      return;
    }
    if (openingPip) return;
    if (!window.documentPictureInPicture) {
      if (trigger !== 'auto') {
        alert('Document Picture-in-Picture is unavailable. Use current Chrome/Edge on localhost or HTTPS.');
      }
      return;
    }

    // Do not insert asynchronous work before requestWindow(). For auto-open,
    // this function is called directly by the trusted click handler so the
    // browser user activation is still live when Document PiP is requested.
    openingPip = true;
    if (trigger === 'auto') autoOpenConsumed = true;
    try {
      const request = window.documentPictureInPicture.requestWindow({
        width: 960, height: 590, disallowReturnToOpener: true
      });
      const win = await request;
      pipWindow = win;
      lastSceneId = null;
      lastFloatingGrid = null;
      activeSceneId = null;
      pipUi = createUi(win);
      updateGridControls();
      win.addEventListener('pagehide', () => {
        if (pipWindow !== win) return;
        // A close is final for automatic opening in this page lifetime. A
        // full Stash reload creates a fresh plugin instance and resets it.
        autoOpenConsumed = true;
        pipWindow = null;
        pipUi = null;
        activeSceneId = null;
        activeTimes = [];
        activeHighRes = false;
        selectedCellIndex = 0;
        ctrlNavigationActive = false;
        ctrlNavigationMoved = false;
        renderSerial++;
        lastSceneId = null;
        lastFloatingGrid = null;
      });
      refreshFloatingGrid();
    } catch (error) {
      console.error('[MrX SceneDeck] Could not open picture-in-picture:', error);
      if (trigger !== 'auto') {
        alert('Could not open MrX SceneDeck: ' + (error && error.message || String(error)));
      }
    } finally {
      openingPip = false;
    }
  }

  async function loadPluginConfiguration() {
    try {
      const response = await fetch(stashUrl('graphql'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query MrXSceneDeckConfiguration { configuration { plugins } }' })
      });
      if (!response.ok) throw new Error('GraphQL HTTP ' + response.status);
      const payload = await response.json();
      if (payload.errors && payload.errors.length) {
        throw new Error(payload.errors.map(item => item.message).join('; '));
      }

      const plugins = payload && payload.data && payload.data.configuration
        ? payload.data.configuration.plugins
        : null;
      const exact = plugins && plugins[PLUGIN_ID];
      const matchingKey = !exact && plugins
        ? Object.keys(plugins).find(key => key.toLowerCase() === PLUGIN_ID.toLowerCase())
        : null;
      const config = exact || (matchingKey ? plugins[matchingKey] : null) || {};
      const value = config.disableAutoOpen;
      const disabled = value === true || value === 1 ||
        ['true', '1', 'yes', 'on'].includes(String(value || '').toLowerCase());
      autoOpenEnabled = !disabled;
      const highResValue = config.disableHighRes;
      const highResDisabled = highResValue === true || highResValue === 1 ||
        ['true', '1', 'yes', 'on'].includes(String(highResValue || '').toLowerCase());
      highResEnabled = !highResDisabled;
      autoOpenConfigLoaded = true;
    } catch (error) {
      // Keep the button-free plugin usable if configuration cannot be read.
      autoOpenEnabled = true;
      highResEnabled = true;
      autoOpenConfigLoaded = true;
      console.warn('[MrX SceneDeck] Could not read settings; automatic opening remains enabled:', error);
    }
  }

  function handleAutoOpenGesture(event) {
    if (!autoOpenConfigLoaded || !autoOpenEnabled || autoOpenConsumed || openingPip) return;
    if (!event.isTrusted || event.button !== 0 || !sceneId()) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (pipWindow && !pipWindow.closed) return;
    if (!window.documentPictureInPicture) return;

    const target = event.target;
    if (!(target instanceof Element) ||
        !target.closest('video, .video-js, [data-vjs-player], .VideoPlayer')) return;

    // This synchronous call is the user-gesture boundary. Do not await
    // configuration or any other promise here.
    void openFloatingWindow('auto');
  }

  function handleRecoveryShortcut(event) {
    const isM = event.code === 'KeyM' || String(event.key || '').toLowerCase() === 'm';
    if (!event.isTrusted || event.repeat || !event.ctrlKey || !event.shiftKey ||
        event.altKey || event.metaKey || !isM) return;
    if (!sceneId() || openingPip) return;
    if (pipWindow && !pipWindow.closed) return;
    if (!window.documentPictureInPicture) return;

    event.preventDefault();
    // A trusted keydown is also a browser user gesture. Keep requestWindow()
    // on this synchronous path, just like the capture-phase player click.
    void openFloatingWindow('shortcut');
  }

  // Capture phase follows the Mosaic Poster developer's suggestion: this runs
  // before Video.js handles the same trusted click, while activation is live.
  // Our opening lock and consumed flag add duplicate/close lifecycle safety.
  document.addEventListener('click', handleAutoOpenGesture, true);
  document.addEventListener('keydown', handleRecoveryShortcut, true);
  void loadPluginConfiguration();
  // Stash is a single-page app. Keep the floating image in sync as the current
  // scene changes; generation itself is de-duplicated per scene and grid size.
  setInterval(() => {
    if (pipWindow && !pipWindow.closed) refreshFloatingGrid();
  }, 900);
})();
