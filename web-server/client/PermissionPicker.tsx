import { useState } from 'react';
import { PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABELS } from '../src/permissions';

export function PermissionPicker({selected,onToggle}:{selected:readonly string[];onToggle:(key:string,checked:boolean)=>void}) {
  const [query,setQuery]=useState('');
  const needle=query.trim().toLowerCase();
  return <details className="permission-picker">
    <summary><span>Permissions</span><span className="pill">{selected.length} / {PERMISSIONS.length}</span></summary>
    <div className="permission-picker-body">
      <label className="permission-search">Find a permission<input aria-label="Find a permission" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search name or key…"/></label>
      <div className="permission-groups">{PERMISSION_GROUPS.map(group=>{
        const keys=group.keys.filter(key=>!needle||PERMISSION_LABELS[key].toLowerCase().includes(needle)||key.toLowerCase().includes(needle)||group.title.toLowerCase().includes(needle));
        if(!keys.length)return null;
        const count=group.keys.filter(key=>selected.includes(key)).length;
        return <details className="permission-group" data-group={group.id} key={group.id} open={needle?true:undefined}>
          <summary><label className="permission-category-toggle" onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} title="Toggle the entire category, including permissions hidden by search">
            <input type="checkbox" data-permission-group={group.id} aria-label={'All '+group.title+' permissions'} checked={count===group.keys.length}
              ref={input=>{if(input)input.indeterminate=count>0&&count<group.keys.length;}}
              onChange={event=>{const checked=event.target.checked;for(const key of group.keys)if(selected.includes(key)!==checked)onToggle(key,checked);}}/>
          </label><span className="permission-category-name">{group.title}</span><span className="pill">{count} / {group.keys.length}</span></summary>
          <div className="permission-group-body"><p>{group.hint}</p><div className="permission-options">{keys.map(key=><label className="checkbox permission-option" key={key} title={key}>
            <input data-permission={key} type="checkbox" checked={selected.includes(key)} onChange={event=>onToggle(key,event.target.checked)}/>
            <span><strong>{PERMISSION_LABELS[key]}</strong><small>{key}</small></span>
          </label>)}</div></div>
        </details>;
      })}</div>
      {needle&&!PERMISSION_GROUPS.some(group=>group.keys.some(key=>PERMISSION_LABELS[key].toLowerCase().includes(needle)||key.toLowerCase().includes(needle)||group.title.toLowerCase().includes(needle)))&&<p className="muted">No permissions match.</p>}
    </div>
  </details>;
}
