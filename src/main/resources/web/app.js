'use strict';
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => value ? new Date(Number(value)).toLocaleString() : '—';
const state = {session:null, players:[], selected:null, detail:null, filter:'all', tab:'overview', view:'players', audit:[], busy:false, refreshBusy:false, detailVersion:0};
const canModerate = () => ['admin','moderator'].includes(state.session?.role);
const isAdmin = () => state.session?.role === 'admin';
const initial = name => esc((name || '?').slice(0,2).toUpperCase());
async function api(path, body, requestId) {
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    if (state.session) headers['X-CSRF-Token'] = state.session.csrf;
    if (requestId) headers['X-Request-ID'] = requestId;
  }
  const response = await fetch('/api' + path, {method:body === undefined ? 'GET' : 'POST',headers,body:body === undefined ? undefined : JSON.stringify(body),credentials:'same-origin'});
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') showLogin();
    throw new Error(data.error || 'Request failed');
  }
  return data;
}
function showLogin() { state.session=null; $('#app').hidden=true; $('#login').hidden=false; $('#action-dialog').close(); }
function showError(error) { $('#page-error').textContent=error.message; $('#page-error').hidden=false; }
function toast(message) { $('#toast').textContent=message; $('#toast').hidden=false; setTimeout(()=>$('#toast').hidden=true,5000); }
async function boot() {
  try {
    const method=await api('/auth/method');
    $('#local-login').hidden=method.mode==='discord';
    $('#discord-login').hidden=method.mode!=='discord';
    document.querySelectorAll('#local-login input').forEach(input=>input.disabled=method.mode==='discord');
    state.session=await api('/session'); $('#login').hidden=true; $('#app').hidden=false;
    $('#staff-name').textContent=state.session.name; $('#staff-role').textContent=(state.session.rank||state.session.role).replaceAll('-', ' '); $('#staff-initial').textContent=state.session.name.slice(0,2).toUpperCase();
    $('#audit-nav').hidden=!isAdmin();
    if (!isAdmin() && state.view==='audit') switchView('players');
    await refresh();
  } catch(e) { showLogin(); const message=new URLSearchParams(location.search).get('loginError'); if(message){$('#login-error').textContent=message;history.replaceState(null,'','/');}else if (!e.message.includes('sign in')) $('#login-error').textContent=e.message; }
}
$('#login-form').addEventListener('submit',async e=>{
  e.preventDefault(); const button=e.target.querySelector('button'); button.disabled=true; $('#login-error').textContent='';
  try { await api('/login',Object.fromEntries(new FormData(e.target))); e.target.reset(); await boot(); }
  catch(err) { $('#login-error').textContent=err.message; } finally { button.disabled=false; }
});
$('#logout').addEventListener('click',async()=>{try {await api('/logout',{}); showLogin();} catch(e){showError(e);}});
async function refresh() {
  if (!state.session || state.refreshBusy) return;
  state.refreshBusy=true; $('#refresh').disabled=true;
  try {
    state.session=await api('/session');
    $('#staff-role').textContent=(state.session.rank||state.session.role).replaceAll('-', ' ');
    $('#audit-nav').hidden=!isAdmin();
    if(!isAdmin()&&state.view==='audit')switchView('players');
    const data=await api('/players'); state.players=data.players;
    $('#nav-count').textContent=state.players.length; $('#stat-total').textContent=state.players.length;
    $('#stat-online').textContent=data.serverPlayers; $('#stat-capacity').textContent=`of ${data.maxPlayers} available slots`;
    $('#stat-punish').textContent=data.punishAvailable?'Connected':'Unavailable';
    $('#last-sync').textContent='Updated '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    $('#connection-text').textContent='Server connected'; $('#connection-dot').classList.remove('stale'); $('#page-error').hidden=true;
    renderPlayers();
    if (state.selected && !$('#action-dialog').open) await loadPlayer(state.selected, false);
    if (state.view==='audit') await loadAudit();
  } catch(e) { $('#connection-text').textContent='Connection interrupted'; $('#connection-dot').classList.add('stale'); showError(e); }
  finally { state.refreshBusy=false; $('#refresh').disabled=false; }
}
$('#refresh').addEventListener('click',refresh);
setInterval(()=>{if(!document.hidden && !$('#action-dialog').open) refresh();},30000);
function renderPlayers() {
  const query=$('#search').value.trim().toLowerCase();
  const rows=state.players.filter(p=>(!query || p.name.toLowerCase().includes(query) || p.uuid.includes(query)) && (state.filter==='all' || p.online === (state.filter==='online')));
  $('#filtered-count').textContent=rows.length;
  $('#player-rows').innerHTML=rows.length?rows.map(p=>`<button class="player-row ${p.uuid===state.selected?'selected':''}" data-player="${esc(p.uuid)}" aria-pressed="${p.uuid===state.selected}"><span class="avatar">${initial(p.name)}</span><span><strong>${esc(p.name)}</strong><small class="${p.online?'online':''}">${p.online?'● Online':'Offline'}</small></span><span class="arrow">›</span></button>`).join(''):'<div class="empty"><h2>No players found</h2><p>Try another name or status filter.</p></div>';
}
$('#search').addEventListener('input',renderPlayers);
$('.filter-tabs').addEventListener('click',e=>{const button=e.target.closest('[data-filter]'); if(!button)return; state.filter=button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('selected',b===button));renderPlayers();});
$('#player-rows').addEventListener('click',e=>{const row=e.target.closest('[data-player]');if(row)loadPlayer(row.dataset.player,true).catch(showError);});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('#action-dialog').open){e.preventDefault();$('#search').focus();}});
async function loadPlayer(id, reset) {
  const version=++state.detailVersion; state.selected=id;
  if(reset){state.tab='overview';state.detail=null;$('#detail').innerHTML='<div class="loading">Loading player records…</div>';renderPlayers();}
  try {const detail=await api('/players/'+id);if(version!==state.detailVersion)return;state.detail=detail; renderDetail();}
  catch(e){if(version===state.detailVersion&&reset)$('#detail').innerHTML='<div class="empty"><h2>Could not load player</h2><p>Use Refresh to try again.</p></div>';throw e;}
}
function renderDetail() {
  const p=state.detail;if(!p)return;
  $('#detail').innerHTML=`<div class="profile-head"><span class="avatar">${initial(p.name)}</span><div><h2>${esc(p.name)} <span class="pill ${p.online?'online':''}">${p.online?'● Online':'Offline'}</span></h2><div class="uuid">${esc(p.uuid)}</div></div><div class="profile-actions">${canModerate()?`<button class="primary" data-action="punish" ${!p.punish?.available?'disabled':''}>＋ Issue punishment</button>`:''}</div></div><div class="detail-tabs">${[['overview','Overview'],['cases','Punishments',p.cases?.length],['notes','Staff notes',p.notes?.length],['security','Security'],['inventory','Inventory'],['enderChest','Ender Chest'],['curios','Curios']].map(([key,label,count])=>`<button data-tab="${key}" class="${state.tab===key?'active':''}">${label}${count!==undefined?' · '+count:''}</button>`).join('')}</div><div class="detail-body">${({overview:overview,cases:cases,notes:notes,security:security,inventory:p=>storage(p,'inventory'),enderChest:p=>storage(p,'enderChest'),curios:p=>storage(p,'curios')})[state.tab](p)}</div>`;
  loadItemIcons();
}
function unavailable(text='No record available') {return `<p>${esc(text)}</p>`;}
function info(title,html,wide=false){return `<article class="info-card ${wide?'wide':''}"><h3>${title}</h3>${html}</article>`;}
function pairs(data){return `<dl>${data.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v ?? '—')}</dd>`).join('')}</dl>`;}
function overview(p){
  const current=(p.cases||[]).filter(c=>c.active&&(!c.until||c.until>Date.now())&&['ban','mute'].includes(c.type));
  return `<div class="info-grid">${info('Moderation summary',pairs([['Current bans / mutes',current.length],['Recorded punishments',p.cases?.length||0],['Staff notes',p.notes?.length||0],['Punish integration',p.punish?.available?'Available':'Unavailable']]))}${info('Discord identity',p.discord?.available?pairs([['Display name',p.discord.displayName],['Account',p.discord.discordTag],['Discord ID',p.discord.discordId],['Linked',date(p.discord.linkedAt)]]):unavailable('No linked Discord account'))}${info('FTB Team',p.teams?.available?`<p><strong>${esc(p.teams.name)}</strong></p>${(p.teams.members||[]).map(m=>`<p>${esc(m.name)} <span class="pill">${esc(m.rankDisplay||m.rank)}</span></p>`).join('')}`:unavailable('No team record available'))}${info('ClockIn',p.clockin?.available?pairs([['Status',p.clockin.clockedIn?'Clocked in':'Clocked out'],['Total time',Math.floor(p.clockin.totalSeconds/3600)+'h '+Math.floor(p.clockin.totalSeconds%3600/60)+'m']]):unavailable())}${info('Review before acting',`<p>Check security evidence, previous punishments, and staff notes before issuing an action. Configured offenses use the Punish mod’s escalation rules.</p>`,true)}</div>`;
}
function caseStatus(c){if(c.removedBy)return 'removed';if(c.until&&c.until<=Date.now())return 'expired';if(!c.active)return c.replaced?'replaced':'inactive';if(['warn','kick'].includes(c.type))return 'recorded';return 'current';}
function cases(p){
  if(!p.punish?.available)return '<div class="notice">Punish is unavailable. Install the compatible Punish mod to administer punishments.</div>';
  if(!p.cases?.length)return '<div class="empty"><h2>No punishment history</h2><p>No records for this player’s UUID.</p></div>';
  return '<p class="fine">UUID records · IP addresses are hidden. Offense cases can be removed here; direct punishments are lifted through the Punish mod’s commands.</p>'+p.cases.map(c=>`<article class="record"><div class="record-top"><span class="pill ${esc(c.type)}">${esc(c.type.toUpperCase())}${c.ipBased?' · IP':''}</span><strong>#${esc(c.id)} ${esc(c.offense||'Direct action')}</strong><span class="pill ${caseStatus(c)}">${caseStatus(c)}</span>${isAdmin()&&c.offense&&c.primary&&!c.removedBy?`<button class="secondary small" data-action="revoke" data-case="${esc(c.caseId)}">Remove case</button>`:''}</div><p>${esc(c.reason)}</p><small>${esc(c.by)} · ${date(c.at)}${['ban','mute'].includes(c.type)?' · Until '+(c.until?date(c.until):'permanent'):''}${c.removedBy?' · Removed by '+esc(c.removedBy):''}</small></article>`).join('');
}
function notes(p){
  if(!p.notesAvailable)return '<div class="notice">Admin Notes is unavailable on this server.</div>';
  return (canModerate()?'<button class="secondary" data-action="note-add">＋ Add staff note</button><p class="fine">Notes are stored by Admin Notes. Only the author can edit or remove them.</p>':'')+(p.notes?.length?p.notes.map(n=>`<article class="record"><div class="record-top"><strong>${esc(n.author)}</strong>${n.system?'<span class="pill">System</span>':''}<small>${date(n.createdAt)}</small></div><p>${esc(n.text)}</p>${canModerate()&&n.canEdit?`<div class="record-actions"><button class="secondary small" data-action="note-edit" data-note="${esc(n.id)}">Edit</button><button class="danger small" data-action="note-remove" data-note="${esc(n.id)}">Remove</button></div>`:''}</article>`).join(''):'<div class="empty"><h2>No staff notes</h2><p>Add useful context for the next review.</p></div>');
}
function security(p){
  const t=p.tsa||{},a=p.ass||{};
  return `<div class="info-grid">${info('TSA Anticheat',t.available?pairs([['Packet checks',t.packetChecks],['Passed',t.packetPasses],['Modified',t.packetModified],['Timeouts',t.packetTimeout],['Last status',t.lastPacketStatus],['Last check',t.lastPacketDate]]):unavailable())}${info('Airport Security',a.available?pairs([['Status',a.status],['Total checks',a.totalChecks],['Clean',a.cleanChecks],['Detected',a.detectedChecks],['Inconclusive',a.inconclusiveChecks],['Cleared',a.clearedDate]]):unavailable())}${info('Stored TSA detections',t.available?(t.detections?.length?t.detections.map(d=>`<p>${esc(d)}</p>`).join(''):unavailable('No stored detections')):unavailable(),true)}${info('Airport detection counts',a.available?pairs(Object.entries(a.detectionCounts||{})):unavailable(),true)}${info('Airport detection dates',a.available?pairs(Object.entries(a.detectionDates||{})):unavailable(),true)}</div>`;
}
const iconCache=new Map();
async function loadItemIcons() {
  const nodes=[...document.querySelectorAll('[data-item-icon]')];
  const ids=[...new Set(nodes.map(n=>n.dataset.itemIcon))].filter(id=>!iconCache.has(id));
  try {
    for(let offset=0;offset<ids.length;offset+=64){
      const icons=await api('/icons',{ids:ids.slice(offset,offset+64)});
      for(const id of ids.slice(offset,offset+64))iconCache.set(id,icons[id]||'');
    }
    for(const node of nodes){
      if(!node.isConnected)continue;
      const src=iconCache.get(node.dataset.itemIcon);
      if(src && /^data:image\/(?:png|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(src)){
        const img=document.createElement('img');img.src=src;img.alt='';node.replaceChildren(img);
      }else node.title='Icon unavailable: this item may require a custom renderer or client assets';
    }
  }catch(e){for(const node of nodes)node.title='Icon request failed: '+e.message; if(nodes.some(n=>n.isConnected))showError(new Error('Item icons could not load: '+e.message));}
}
function storage(p, kind) {
  const snapshot=p.storage, section=snapshot?.[kind];
  if(!section?.available)return `<div class="notice">${esc(section?.reason||'Inventory data is unavailable. Refresh the player to try again.')}</div>`;
  const heading=snapshot.source==='saved'?`Last saved data · ${date(snapshot.savedAt)} · Player is offline`:`Live snapshot · ${date(snapshot.capturedAt)}`;
  const groups=section.groups||[];
  return `<p class="notice">${esc(heading)}. Read-only; refresh to see changes.</p>${groups.length?groups.map(g=>`<section class="storage-group"><h3>${esc(g.name)} <span class="pill">${g.slots.filter(s=>!s.empty).length} / ${g.slots.length} occupied</span></h3><div class="storage-grid">${g.slots.map(s=>s.empty?`<div class="item-slot empty-slot" aria-label="${esc(s.label)}: empty"><small>${esc(s.label)}</small><span>Empty</span></div>`:`<details class="item-slot ${s.selected?'held-item':''}"><summary title="${esc(s.name+' · '+s.id)}"><small>${esc(s.label)}${s.selected?' · Selected':''}</small><span class="item-art" data-item-icon="${esc(s.id)}" aria-hidden="true">◇</span><strong>${esc(s.name)}</strong><span class="item-count">×${esc(s.count)}</span></summary><div class="item-properties"><code>${esc(s.id)}</code>${s.maxDamage?`<p>Durability: ${esc(Math.max(0,s.maxDamage-s.damage))} / ${esc(s.maxDamage)}</p>`:''}${(s.enchantments||[]).map(v=>`<p class="enchantment">${esc(v)}</p>`).join('')}${(s.lore||[]).map(v=>`<p>${esc(v)}</p>`).join('')}</div></details>`).join('')}</div></section>`).join(''):'<div class="empty"><h2>No Curios slots</h2><p>This player has no configured accessory slots.</p></div>'}`;
}
$('#detail').addEventListener('click',e=>{const tab=e.target.closest('[data-tab]');if(tab){state.tab=tab.dataset.tab;renderDetail();}const action=e.target.closest('[data-action]');if(action)openAction(action.dataset);});
let actionContext=null;
function openAction(data){
  const p=state.detail; if(!p)return;
  actionContext={action:data.action,uuid:p.uuid,noteId:data.note,caseId:data.case,requestId:Array.from(crypto.getRandomValues(new Uint8Array(32)), b=>b.toString(16).padStart(2,'0')).join('')};
  const form=$('#action-form');form.reset();$('#action-error').textContent='';$('#submit-action').disabled=false;
  const punish=data.action==='punish', note=data.action.startsWith('note-'), removing=data.action==='note-remove';
  $('#punish-fields').hidden=!punish;$('#reason-label').hidden=note;$('#note-label').hidden=!note||removing;
  form.elements.reason.required=!note;form.elements.text.required=note&&!removing;
  $('#dialog-title').textContent=({'punish':'Issue punishment','note-add':'Add staff note','note-edit':'Edit staff note','note-remove':'Remove staff note','revoke':'Remove offense case'})[data.action];
  $('#dialog-target').textContent=`${p.name} · ${p.uuid}`;
  $('#action-warning').textContent=note?'This change is saved to Admin Notes and logged in the audit trail.':data.action==='revoke'?'This removes the entire configured offense case, including its related punishments. The reason is kept in the web audit trail.':'This applies immediately through the server’s Punish mod and is recorded in the audit trail.';
  $('#submit-action').textContent=removing?'Remove note':data.action==='revoke'?'Remove case':note?'Save note':'Confirm punishment';
  for(const option of $('#punish-type').options) option.disabled=!isAdmin()&&['BAN','OFFENSE'].includes(option.value);
  $('#offense-select').innerHTML=(p.punish?.offenses||[]).map(o=>`<option value="${esc(o.id)}">${esc(o.name||o.id)} · ${esc(o.group||'')}</option>`).join('');
  if(data.note){const n=p.notes.find(n=>n.id===data.note);if(n)form.elements.text.value=n.text;}
  updateActionFields();$('#action-dialog').showModal();
}
function updateActionFields(){const type=$('#punish-type').value;$('#duration-label').hidden=!['MUTE','BAN'].includes(type);$('#offense-label').hidden=type!=='OFFENSE';$('#offense-select').required=type==='OFFENSE'&&actionContext?.action==='punish';const o=state.detail?.punish?.offenses?.find(o=>o.id===$('#offense-select').value);$('#offense-steps').textContent=o?.steps?'Escalation: '+o.steps.join(' → '):'';}
$('#punish-type').addEventListener('change',updateActionFields);$('#offense-select').addEventListener('change',updateActionFields);
function closeDialog(){if(!state.busy)$('#action-dialog').close();}
$('#close-dialog').addEventListener('click',closeDialog);$('#cancel-dialog').addEventListener('click',closeDialog);
$('#action-dialog').addEventListener('cancel',e=>{if(state.busy)e.preventDefault();});
$('#action-form').addEventListener('submit',async e=>{
  e.preventDefault();if(state.busy)return;state.busy=true;$('#submit-action').disabled=true;$('#action-error').textContent='';
  const ctx={...actionContext},fields=Object.fromEntries(new FormData(e.target));
  const body=ctx.action==='punish'?{type:fields.type,offense:fields.offense,durationMinutes:Number(fields.durationMinutes),silent:fields.silent==='on',reason:fields.reason}:ctx.action==='revoke'?{caseId:Number(ctx.caseId),reason:fields.reason}:{text:fields.text,noteId:ctx.noteId};
  try {
    await api('/players/'+ctx.uuid+'/'+ctx.action,body,ctx.requestId);$('#action-dialog').close();toast('Action saved successfully.');
    try{await loadPlayer(ctx.uuid,false);}catch(err){showError(err);}
  }catch(err){$('#action-error').textContent=err.message+' Close this dialog and refresh before submitting another action.';}
  finally{state.busy=false; /* The request ID is single-use, including failed attempts. Reopen only after reviewing state. */}
});
function switchView(view){
  state.view=view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  for(const name of ['players','audit','integrations'])$('#'+name+'-view').hidden=name!==view;
  $('#breadcrumb').textContent=({players:'Players',audit:'Audit trail',integrations:'Integrations'})[view];
  $('#page-title').textContent=({players:'Player directory.',audit:'Accountability, built in.',integrations:'Connected context.'})[view];
  $('#page-description').textContent=({players:'Know the player. Review the context. Take the right action.',audit:'A durable record of staff actions and their outcomes.',integrations:'Your existing server tools, brought into one workspace.'})[view];
  if(view==='audit')loadAudit().catch(showError);
}
$('nav').addEventListener('click',e=>{const button=e.target.closest('[data-view]');if(button)switchView(button.dataset.view);});
async function loadAudit(){
  state.audit=await api('/audit');
  $('#audit-rows').innerHTML=state.audit.length?`<table><thead><tr><th>Time / staff</th><th>Action</th><th>Player UUID</th><th>Outcome</th></tr></thead><tbody>${state.audit.map(a=>`<tr><td>${date(a.at)}<br><strong>${esc(a.actor)}</strong></td><td>${esc(a.action)}</td><td>${esc(a.target||'—')}<details><summary>Details</summary><pre>${esc(JSON.stringify(a.detail,null,2))}</pre></details></td><td><span class="pill ${esc(a.state)}">${esc(a.state)}</span></td></tr>`).join('')}</tbody></table>`:'<div class="empty"><h2>No audit events yet</h2></div>';
}
$('#export-audit').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(state.audit,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='admin-panel-audit-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('#integration-cards').innerHTML=[['Admin GUI','Required · 1.1.0+','Known player directory and aggregated player profiles.'],['Punish','Optional · compatible 1.0.0 API','Direct punishments, configured escalation, and offense case removal.'],['Admin Notes','Optional','Shared notes with author-controlled editing and removal.'],['TSA Anticheat','Optional','Packet checks and stored detections for player review.'],['Airport Security','Optional','Check results, detection counts, and clearance records.'],['FTB Teams','Optional','Team membership and player ranks.'],['Discord Link','Optional','Linked Discord identity and account information.'],['ClockIn','Optional','Clock-in status and recorded time.']].map(([name,tag,description])=>`<article class="card"><span class="pill">${esc(tag)}</span><h2>${esc(name)}</h2><p>${esc(description)}</p></article>`).join('');
boot();
