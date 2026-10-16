'use strict';
const $=id=>document.getElementById(id), list=$('rank-list');
let ranks=[{name:'dev',roleId:'',access:'admin'},{name:'owner',roleId:'',access:'admin'},{name:'admin',roleId:'',access:'admin'},{name:'mod',roleId:'',access:'moderator'},{name:'helper',roleId:'',access:'viewer'}];
function render(){
  list.replaceChildren();
  ranks.forEach((r,i)=>{
    const row=document.createElement('div');row.className='rank';
    const name=document.createElement('input');name.value=r.name;name.placeholder='Rank key (owner, dev...)';name.setAttribute('aria-label','Rank name');name.oninput=()=>r.name=name.value;
    const id=document.createElement('input');id.value=r.roleId;id.placeholder='Discord role ID';id.setAttribute('aria-label','Discord role ID');id.oninput=()=>r.roleId=id.value;
    const access=document.createElement('select');access.setAttribute('aria-label','Access level');
    for(const a of ['admin','moderator','viewer','deny']){const o=document.createElement('option');o.value=a;o.textContent=a;access.append(o);}
    access.value=r.access;access.onchange=()=>r.access=access.value;
    const controls=document.createElement('div');
    for(const [label,fn,disabled] of [['↑',()=>{[ranks[i-1],ranks[i]]=[ranks[i],ranks[i-1]];render();},i===0],['↓',()=>{[ranks[i+1],ranks[i]]=[ranks[i],ranks[i+1]];render();},i===ranks.length-1],['×',()=>{ranks.splice(i,1);render();},false]]){
      const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.disabled=disabled;b.onclick=fn;controls.append(b);
    }
    row.append(name,id,access,controls);list.append(row);
  });
}
$('add-rank').onclick=()=>{if(ranks.length<30){ranks.push({name:'',roleId:'',access:'viewer'});render();}};
$('setup').onsubmit=async e=>{
  e.preventDefault();$('save').disabled=true;$('message').textContent='Saving…';
  try{
    const payload={token:$('token').value,origin:$('origin').value,bind:$('bind').value,port:Number($('port').value),
      guildId:$('guild').value,clientId:$('client').value,clientSecret:$('secret').value,ranks};
    const response=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Setup failed');
    $('message').textContent='Configuration saved. Restart the Minecraft server to start the Admin Panel. Close this setup tab.';
    $('secret').value='';$('token').value='';
  }catch(error){$('message').textContent=error.message;$('save').disabled=false;}
};
render();
