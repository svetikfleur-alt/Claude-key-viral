/**
 * Hybrid Media Platform — Dashboard
 * Vanilla JS SPA. No build step required.
 */

const API = 'http://127.0.0.1:3333/api';

// ── Utilities ────────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? 'API error');
  return json.data;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function statusBadge(status) {
  const map = {
    queued: 'badge-muted', routing: 'badge-blue', running: 'badge-warn',
    completed: 'badge-green', failed: 'badge-danger', cancelled: 'badge-muted',
  };
  return `<span class="badge ${map[status] ?? 'badge-muted'}">${esc(status)}</span>`;
}

function kindIcon(kind) {
  return { image: '🖼', video: '🎬', audio: '🎵', 'model-3d': '🧊', svg: '◈', document: '📄' }[kind] ?? '◫';
}

// ── Toast ────────────────────────────────────────────────────────────────────

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Router ───────────────────────────────────────────────────────────────────

let currentView = 'dashboard';

function navigate(view) {
  currentView = view;
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.view === view);
  });
  renderView(view);
}

document.addEventListener('click', e => {
  const link = e.target.closest('[data-view]');
  if (link) { e.preventDefault(); navigate(link.dataset.view); }
});

// ── Status polling ───────────────────────────────────────────────────────────

async function pollStatus() {
  try {
    const status = await apiFetch('/status');
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    const comfy = status.backends.find(b => b.backend === 'comfyui-local');
    if (comfy?.available) {
      dot.className = 'status-dot ok';
      label.textContent = 'ComfyUI online';
    } else {
      dot.className = 'status-dot error';
      label.textContent = 'ComfyUI offline';
    }
    return status;
  } catch {
    document.getElementById('status-dot').className = 'status-dot error';
    document.getElementById('status-label').textContent = 'Server offline';
    return null;
  }
}

// ── Views ────────────────────────────────────────────────────────────────────

async function renderView(view) {
  const main = document.getElementById('main-content');
  main.innerHTML = '<div style="color:var(--sub);padding:40px">Loading…</div>';
  try {
    switch (view) {
      case 'dashboard':  main.innerHTML = await viewDashboard(); break;
      case 'generate':   main.innerHTML = viewGenerate(); bindGenerateForm(); break;
      case 'assets':     main.innerHTML = await viewAssets(); bindAssetSearch(); break;
      case 'jobs':       main.innerHTML = await viewJobs(); break;
      case 'projects':   main.innerHTML = await viewProjects(); bindProjectForm(); break;
      case 'workflows':  main.innerHTML = await viewWorkflows(); break;
      default:           main.innerHTML = '<p>Unknown view</p>';
    }
  } catch (e) {
    main.innerHTML = `<div class="card" style="color:var(--danger)">Error: ${esc(e.message)}</div>`;
  }
}

// ── Dashboard view ───────────────────────────────────────────────────────────

async function viewDashboard() {
  const [status, { jobs }, { assets }] = await Promise.all([
    apiFetch('/status'),
    apiFetch('/jobs?limit=5'),
    apiFetch('/assets?limit=8&sort=created_at_desc'),
  ]);

  const backends = status.backends.map(b => `
    <div class="backend-row">
      <div class="backend-dot ${b.available ? 'ok' : 'err'}"></div>
      <span class="backend-name">${esc(b.backend)}</span>
      <span class="backend-msg">${esc(b.message)}</span>
    </div>`).join('');

  const recentJobs = jobs.length
    ? jobs.map(j => `
      <div class="job-row">
        <div>
          <div class="job-label">${esc(j.label)}</div>
          <div class="job-meta">${esc(j.modality)} · ${relTime(j.created_at)}</div>
        </div>
        ${statusBadge(j.status)}
        <span class="badge badge-muted">${esc(j.backend_used ?? '—')}</span>
        <button class="btn btn-ghost btn-sm" onclick="navigate('jobs')">View</button>
      </div>`).join('')
    : '<div class="empty-state"><div class="empty-icon">⟳</div><p>No jobs yet</p></div>';

  const recentAssets = assets.length
    ? `<div class="asset-grid">${assets.map(assetCard).join('')}</div>`
    : '<div class="empty-state"><div class="empty-icon">◫</div><p>No assets yet — generate something</p></div>';

  return `
    <div class="view-header">
      <div class="view-title">Dashboard</div>
      <div class="view-sub">Hybrid media platform overview</div>
    </div>
    <div class="grid-4" style="margin-bottom:28px">
      <div class="card stat-card">
        <div class="stat-value">${status.total_assets}</div>
        <div class="stat-label">Total Assets</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">${status.total_jobs}</div>
        <div class="stat-label">Total Jobs</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">${status.active_jobs}</div>
        <div class="stat-label">Active Jobs</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">${status.uptime_seconds}s</div>
        <div class="stat-label">Uptime</div>
      </div>
    </div>
    <div class="grid-2" style="margin-bottom:28px">
      <div class="card">
        <div class="section-title">Backends</div>
        <div class="backend-list">${backends}</div>
      </div>
      <div class="card">
        <div class="section-title">Recent Jobs</div>
        <div class="job-list">${recentJobs}</div>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="margin-bottom:16px">Recent Assets</div>
      ${recentAssets}
    </div>`;
}

// ── Generate view ────────────────────────────────────────────────────────────

function viewGenerate() {
  const modalities = [
    'text-to-image','text-to-video','image-to-image','image-to-video',
    'text-to-audio','image-to-3d','video-upscale','image-upscale',
    'inpaint','outpaint','remove-background','code-render','scene-graph','cinematic-treatment',
  ];
  const backends = ['auto','code-svg','code-html-card','code-remotion','comfyui-local'];

  return `
    <div class="view-header">
      <div class="view-title">Generate</div>
      <div class="view-sub">Submit a new media generation job</div>
    </div>
    <div class="card generate-form">
      <form id="generate-form">
        <div class="form-group">
          <label class="form-label">Label (optional)</label>
          <input class="form-input" id="gen-label" type="text" placeholder="My hero banner" />
        </div>
        <div class="form-group">
          <label class="form-label">Prompt *</label>
          <textarea class="form-textarea" id="gen-prompt" placeholder="Describe what you want to generate…" required></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Modality *</label>
            <select class="form-select" id="gen-modality">
              ${modalities.map(m => `<option value="${m}">${m}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Backend</label>
            <select class="form-select" id="gen-backend">
              ${backends.map(b => `<option value="${b}">${b}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Width (px)</label>
            <input class="form-input" id="gen-width" type="number" placeholder="1200" min="64" max="4096" />
          </div>
          <div class="form-group">
            <label class="form-label">Height (px)</label>
            <input class="form-input" id="gen-height" type="number" placeholder="630" min="64" max="4096" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Seed (optional)</label>
            <input class="form-input" id="gen-seed" type="number" placeholder="Random" />
          </div>
          <div class="form-group">
            <label class="form-label">Duration (seconds, video/audio)</label>
            <input class="form-input" id="gen-duration" type="number" placeholder="8" min="1" max="120" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Negative prompt (diffusion models)</label>
          <input class="form-input" id="gen-negative" type="text" placeholder="blurry, low quality…" />
        </div>
        <div class="form-group">
          <label class="form-label">Tags (comma-separated)</label>
          <input class="form-input" id="gen-tags" type="text" placeholder="hero, launch, v1" />
        </div>
        <div id="gen-result" style="margin-bottom:14px"></div>
        <button class="btn btn-primary" type="submit" id="gen-submit">✦ Generate</button>
      </form>
    </div>`;
}

function bindGenerateForm() {
  document.getElementById('generate-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('gen-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    const resultEl = document.getElementById('gen-result');
    resultEl.innerHTML = '';

    const tagsRaw = document.getElementById('gen-tags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

    const body = {
      label: document.getElementById('gen-label').value.trim() || undefined,
      prompt: document.getElementById('gen-prompt').value.trim(),
      modality: document.getElementById('gen-modality').value,
      backend: document.getElementById('gen-backend').value,
      width: parseInt(document.getElementById('gen-width').value) || undefined,
      height: parseInt(document.getElementById('gen-height').value) || undefined,
      seed: parseInt(document.getElementById('gen-seed').value) || undefined,
      duration_seconds: parseInt(document.getElementById('gen-duration').value) || undefined,
      negative_prompt: document.getElementById('gen-negative').value.trim() || undefined,
      asset_tags: tags.length ? tags : undefined,
    };

    try {
      const job = await apiFetch('/jobs', { method: 'POST', body: JSON.stringify(body) });
      resultEl.innerHTML = `<div class="badge badge-green" style="padding:8px 14px;font-size:13px">
        Job submitted: ${esc(job.id.slice(0,8))} — ${statusBadge(job.status)}
      </div>`;
      toast('Job submitted successfully', 'success');
      // Poll for completion
      pollJob(job.id, resultEl);
    } catch (err) {
      resultEl.innerHTML = `<div class="badge badge-danger" style="padding:8px 14px">${esc(err.message)}</div>`;
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '✦ Generate';
    }
  });
}

async function pollJob(jobId, resultEl) {
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const job = await apiFetch(`/jobs/${jobId}`);
      if (job.status === 'completed') {
        resultEl.innerHTML = `<div class="badge badge-green" style="padding:8px 14px">
          ✓ Completed in ${job.duration_seconds?.toFixed(1)}s — ${job.output_asset_ids.length} asset(s)
          <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="navigate('assets')">View Assets</button>
        </div>`;
        toast('Generation complete', 'success');
        return;
      }
      if (job.status === 'failed') {
        resultEl.innerHTML = `<div class="badge badge-danger" style="padding:8px 14px">✗ Failed: ${esc(job.error)}</div>`;
        toast('Job failed: ' + job.error, 'error');
        return;
      }
      resultEl.innerHTML = `<div class="badge badge-warn" style="padding:8px 14px">
        ${statusBadge(job.status)} — ${esc(job.backend_used ?? 'routing…')}
      </div>`;
    } catch { break; }
  }
}

// ── Asset Library view ───────────────────────────────────────────────────────

function assetCard(a) {
  const thumb = (a.kind === 'image' || a.kind === 'svg')
    ? `<img class="asset-thumb" src="${API.replace('/api','')}/api/assets/${a.id}/file" alt="${esc(a.title)}" loading="lazy" />`
    : `<div class="asset-thumb-placeholder">${kindIcon(a.kind)}</div>`;
  const tags = a.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('');
  return `
    <div class="asset-card" onclick="openAsset('${a.id}')">
      ${thumb}
      <div class="asset-info">
        <div class="asset-name">${esc(a.title ?? a.filename)}</div>
        <div class="asset-meta">${kindIcon(a.kind)} ${esc(a.kind)} · ${relTime(a.created_at)}</div>
        ${tags ? `<div class="asset-tags">${tags}</div>` : ''}
      </div>
    </div>`;
}

async function viewAssets(query = {}) {
  const params = new URLSearchParams({ limit: '48', sort: 'created_at_desc', ...query });
  const { assets, total } = await apiFetch(`/assets?${params}`);

  const filters = `
    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
      <input id="asset-search" class="form-input" style="flex:1;min-width:200px" placeholder="Search assets…" value="${esc(query.search ?? '')}" />
      <select id="asset-kind" class="form-select" style="width:140px">
        <option value="">All kinds</option>
        ${['image','video','audio','svg','model-3d','document'].map(k =>
          `<option value="${k}" ${query.kind === k ? 'selected' : ''}>${k}</option>`).join('')}
      </select>
      <select id="asset-modality" class="form-select" style="width:180px">
        <option value="">All modalities</option>
        ${['text-to-image','text-to-video','image-to-image','image-to-video','code-render','scene-graph'].map(m =>
          `<option value="${m}" ${query.modality === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      <button class="btn btn-ghost" onclick="apiFetch('/assets/validate',{method:'POST'}).then(r=>toast('Validated: '+r.checked+' assets, '+r.missing+' missing','info'))">
        Validate
      </button>
    </div>`;

  const grid = assets.length
    ? `<div class="asset-grid">${assets.map(assetCard).join('')}</div>`
    : '<div class="empty-state"><div class="empty-icon">◫</div><p>No assets found</p></div>';

  return `
    <div class="view-header">
      <div class="view-title">Asset Library</div>
      <div class="view-sub">${total} asset${total === 1 ? '' : 's'} total</div>
    </div>
    ${filters}
    ${grid}`;
}

function bindAssetSearch() {
  let debounce;
  const run = () => {
    const search = document.getElementById('asset-search')?.value.trim();
    const kind = document.getElementById('asset-kind')?.value;
    const modality = document.getElementById('asset-modality')?.value;
    const q = {};
    if (search) q.search = search;
    if (kind) q.kind = kind;
    if (modality) q.modality = modality;
    viewAssets(q).then(html => {
      document.getElementById('main-content').innerHTML = html;
      bindAssetSearch();
    });
  };
  document.getElementById('asset-search')?.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(run, 350);
  });
  document.getElementById('asset-kind')?.addEventListener('change', run);
  document.getElementById('asset-modality')?.addEventListener('change', run);
}

async function openAsset(id) {
  const asset = await apiFetch(`/assets/${id}`);
  const fileUrl = `${API.replace('/api','')}/api/assets/${id}/file`;
  const preview = asset.kind === 'image' || asset.kind === 'svg'
    ? `<img src="${fileUrl}" style="max-width:100%;border-radius:8px;margin-bottom:16px" />`
    : asset.kind === 'video'
    ? `<video src="${fileUrl}" controls style="max-width:100%;border-radius:8px;margin-bottom:16px"></video>`
    : `<div class="asset-thumb-placeholder" style="height:120px;border-radius:8px;margin-bottom:16px">${kindIcon(asset.kind)}</div>`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:680px">
      <div class="modal-title">${esc(asset.title ?? asset.filename)}</div>
      ${preview}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;color:var(--sub);margin-bottom:12px">
        <div><b>Kind:</b> ${esc(asset.kind)}</div>
        <div><b>Modality:</b> ${esc(asset.modality ?? '—')}</div>
        <div><b>Backend:</b> ${esc(asset.backend ?? '—')}</div>
        <div><b>Size:</b> ${asset.file_size_bytes ? (asset.file_size_bytes/1024).toFixed(1)+'KB' : '—'}</div>
        <div><b>Created:</b> ${relTime(asset.created_at)}</div>
        <div><b>Exists:</b> ${asset.exists ? '✓' : '✗ missing'}</div>
      </div>
      ${asset.prompt ? `<div style="font-size:13px;color:var(--sub);margin-bottom:12px"><b>Prompt:</b> ${esc(asset.prompt)}</div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:16px">
        ${asset.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
      </div>
      <div class="modal-actions">
        <a class="btn btn-ghost" href="${fileUrl}" download="${esc(asset.filename)}">Download</a>
        <button class="btn btn-danger btn-sm" onclick="deleteAsset('${id}')">Delete record</button>
        <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">Close</button>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function deleteAsset(id) {
  if (!confirm('Remove this asset record? (File on disk is not deleted)')) return;
  await apiFetch(`/assets/${id}`, { method: 'DELETE' });
  toast('Asset record removed', 'info');
  document.querySelector('.modal-overlay')?.remove();
  navigate('assets');
}

// ── Jobs view ────────────────────────────────────────────────────────────────

async function viewJobs() {
  const { jobs, total } = await apiFetch('/jobs?limit=50');

  const rows = jobs.length
    ? jobs.map(j => `
      <div class="job-row">
        <div>
          <div class="job-label">${esc(j.label)}</div>
          <div class="job-meta">
            ${esc(j.modality)} · ${esc(j.backend_used ?? 'pending')} · ${relTime(j.created_at)}
            ${j.duration_seconds ? ` · ${j.duration_seconds.toFixed(1)}s` : ''}
          </div>
          ${j.error ? `<div style="font-size:12px;color:var(--danger);margin-top:3px">${esc(j.error)}</div>` : ''}
        </div>
        ${statusBadge(j.status)}
        <span class="badge badge-muted">${j.output_asset_ids.length} asset${j.output_asset_ids.length === 1 ? '' : 's'}</span>
        ${j.status === 'queued'
          ? `<button class="btn btn-danger btn-sm" onclick="cancelJob('${j.id}')">Cancel</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="viewJobAssets('${j.id}')">Assets</button>`}
      </div>`).join('')
    : '<div class="empty-state"><div class="empty-icon">⟳</div><p>No jobs yet</p></div>';

  return `
    <div class="view-header">
      <div class="view-title">Jobs</div>
      <div class="view-sub">${total} job${total === 1 ? '' : 's'} total</div>
    </div>
    <div style="margin-bottom:14px">
      <button class="btn btn-ghost btn-sm" onclick="navigate('jobs')">↻ Refresh</button>
    </div>
    <div class="job-list">${rows}</div>`;
}

async function cancelJob(id) {
  await apiFetch(`/jobs/${id}/cancel`, { method: 'DELETE' });
  toast('Job cancelled', 'info');
  navigate('jobs');
}

async function viewJobAssets(jobId) {
  const main = document.getElementById('main-content');
  const { assets, total } = await apiFetch(`/assets?job_id=${jobId}&limit=50`);
  const grid = assets.length
    ? `<div class="asset-grid">${assets.map(assetCard).join('')}</div>`
    : '<div class="empty-state"><p>No assets for this job</p></div>';
  main.innerHTML = `
    <div class="view-header">
      <div class="view-title">Job Assets</div>
      <div class="view-sub">${total} asset${total === 1 ? '' : 's'}</div>
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-bottom:16px" onclick="navigate('jobs')">← Back to Jobs</button>
    ${grid}`;
}

// ── Projects view ────────────────────────────────────────────────────────────

async function viewProjects() {
  const projects = await apiFetch('/projects');

  const cards = projects.length
    ? projects.map(p => `
      <div class="card" style="display:flex;align-items:center;gap:16px">
        <div style="flex:1">
          <div style="font-weight:700;font-size:16px">${esc(p.name)}</div>
          ${p.description ? `<div style="font-size:13px;color:var(--sub);margin-top:3px">${esc(p.description)}</div>` : ''}
          <div style="display:flex;gap:4px;margin-top:6px">${p.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="navigate('assets')">Assets</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProject('${p.id}')">Delete</button>
        </div>
      </div>`).join('')
    : '<div class="empty-state"><div class="empty-icon">◻</div><p>No projects yet</p></div>';

  return `
    <div class="view-header">
      <div class="view-title">Projects</div>
      <div class="view-sub">Organize your media jobs and assets</div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="section-title">New Project</div>
      <form id="project-form" style="display:flex;gap:10px;flex-wrap:wrap">
        <input class="form-input" id="proj-name" placeholder="Project name" required style="flex:1;min-width:180px" />
        <input class="form-input" id="proj-desc" placeholder="Description (optional)" style="flex:2;min-width:200px" />
        <input class="form-input" id="proj-tags" placeholder="Tags (comma-separated)" style="flex:1;min-width:160px" />
        <button class="btn btn-primary" type="submit">Create</button>
      </form>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px">${cards}</div>`;
}

function bindProjectForm() {
  document.getElementById('project-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('proj-name').value.trim();
    const desc = document.getElementById('proj-desc').value.trim();
    const tagsRaw = document.getElementById('proj-tags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    await apiFetch('/projects', { method: 'POST', body: JSON.stringify({ name, description: desc || undefined, tags }) });
    toast('Project created', 'success');
    navigate('projects');
  });
}

async function deleteProject(id) {
  if (!confirm('Delete this project?')) return;
  await apiFetch(`/projects/${id}`, { method: 'DELETE' });
  toast('Project deleted', 'info');
  navigate('projects');
}

// ── Workflows view ───────────────────────────────────────────────────────────

async function viewWorkflows() {
  const [workflows, backends] = await Promise.all([
    apiFetch('/workflows'),
    apiFetch('/backends'),
  ]);

  const wfRows = workflows.length
    ? workflows.map(w => `
      <div class="card" style="margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="flex:1">
            <div style="font-weight:700">${esc(w.workflow_name)}</div>
            ${w.description ? `<div style="font-size:13px;color:var(--sub)">${esc(w.description)}</div>` : ''}
            <div style="font-size:12px;color:var(--muted);margin-top:3px">${esc(w.file)}</div>
          </div>
          <span class="badge ${w.has_mapping ? 'badge-green' : 'badge-warn'}">${w.has_mapping ? 'mapped' : 'no mapping'}</span>
          <button class="btn btn-primary btn-sm" onclick="quickRun('${esc(w.workflow_name)}')">Run</button>
        </div>
      </div>`).join('')
    : '<div class="empty-state"><p>No workflows configured. Add workflows to config.json.</p></div>';

  const backendRows = backends.map(b => `
    <div class="backend-row">
      <div class="backend-dot ${b.available ? 'ok' : 'err'}"></div>
      <span class="backend-name">${esc(b.backend)}</span>
      ${b.url ? `<span class="badge badge-muted">${esc(b.url)}</span>` : ''}
      <span class="backend-msg">${esc(b.message)}</span>
    </div>`).join('');

  return `
    <div class="view-header">
      <div class="view-title">Workflows & Backends</div>
      <div class="view-sub">ComfyUI workflows and renderer backends</div>
    </div>
    <div class="grid-2">
      <div>
        <div class="section-title">ComfyUI Workflows</div>
        ${wfRows}
      </div>
      <div>
        <div class="section-title">Available Backends</div>
        <div class="backend-list">${backendRows}</div>
      </div>
    </div>`;
}

function quickRun(workflowName) {
  navigate('generate');
  setTimeout(() => {
    const sel = document.getElementById('gen-modality');
    if (sel) sel.value = 'text-to-image';
    const backendSel = document.getElementById('gen-backend');
    if (backendSel) backendSel.value = 'comfyui-local';
    const label = document.getElementById('gen-label');
    if (label) label.value = `Quick run: ${workflowName}`;
    // Store workflow name for submission
    document.getElementById('generate-form').dataset.workflow = workflowName;
  }, 50);
}

// ── Boot ─────────────────────────────────────────────────────────────────────

pollStatus();
setInterval(pollStatus, 15000);
renderView('dashboard');
