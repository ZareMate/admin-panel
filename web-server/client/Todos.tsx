import { useCallback,useEffect,useRef,useState } from 'react';
import type { Api,Session } from './types';
import type {TodoAssignee} from '../src/todo-assignees';
import type { Todo } from '../src/todos';
import { has } from '../src/permissions';
const statuses={todo:'To do',doing:'In progress',done:'Done'};
const blank={title:'',description:'',status:'todo' as Todo['status'],priority:'normal' as Todo['priority'],assignee:'',assigneeId:''};
export function Todos({api,session,onAssignedCount}:{api:Api;session:Session;onAssignedCount?:(count:number)=>void}) {
 const [directoryRefresh,setDirectoryRefresh]=useState(0);
 const [assignees,setAssignees]=useState<TodoAssignee[]>([]),[assigneeError,setAssigneeError]=useState('');
 const [mine,setMine]=useState({todo:0,doing:0,total:0});
 const dragged=useRef<string|null>(null),moving=useRef(false);
 const [dragging,setDragging]=useState<string|null>(null),[over,setOver]=useState<string|null>(null),[moveNotice,setMoveNotice]=useState('');
 const [tasks,setTasks]=useState<Todo[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState(''),[editor,setEditor]=useState<Partial<Todo>|null>(null),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{try{const r=await api<{tasks:Todo[];mine:{todo:number;doing:number;total:number}}>('/todos');setTasks(r.tasks);setMine(r.mine);onAssignedCount?.(r.mine.total);setError('');}catch(e){setError((e as Error).message);}finally{setLoaded(true);}},[api,onAssignedCount]);
 useEffect(()=>{void load();const timer=setInterval(()=>{if(!document.hidden)void load();},30000);return()=>clearInterval(timer);},[load]);
 useEffect(()=>{let active=true;void api<{assignees:TodoAssignee[]}>('/todos/assignees').then(result=>{if(active){setAssignees(result.assignees);setAssigneeError('');}}).catch(e=>{if(active)setAssigneeError('Assignee list unavailable: '+e.message);});return()=>{active=false;};},[api,directoryRefresh]);
 const save=async(task:Partial<Todo>)=>{setBusy(true);try{await api(task.id?'/todos/'+task.id+'/edit':'/todos',task);setEditor(null);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const canMove=has(session,'todo.edit')&&!busy&&!editor;
 const move=async(id:string,status:Todo['status'])=>{
  const task=tasks.find(t=>t.id===id);if(!canMove||moving.current||!task||task.status===status)return;
  moving.current=true;setBusy(true);setError('');setMoveNotice('');
  try{const updated=await api<Todo>('/todos/'+id+'/edit',{...task,status});setTasks(old=>old.map(t=>t.id===id?updated:t));await load();setMoveNotice(task.title+' moved to '+statuses[status]+'.');}
  catch(e){setError((e as Error).message);}finally{moving.current=false;setBusy(false);}
 };
 const endDrag=()=>{dragged.current=null;setDragging(null);setOver(null);};
 const assigneeName=(task:Partial<Todo>)=>assignees.find(person=>person.id===task.assigneeId)?.name||task.assignee||'Unassigned';
 const shown=tasks.filter(t=>(t.title+' '+t.description+' '+assigneeName(t)).toLowerCase().includes(query.toLowerCase()));
 return <section id="todo-board"><div className="card section-header"><div><h2>Build a better server</h2><p className="muted">Bugs, improvements, and the next thing to build.</p></div><div className="board-actions"><button className="secondary" disabled={busy} onClick={()=>{void load();setDirectoryRefresh(old=>old+1);}}>Refresh tasks</button>{has(session,'todo.create')&&<button className="primary" onClick={()=>setEditor({...blank})}>New task</button>}</div></div>
 <p className="notice todo-mine" role="status">Your tasks: <strong>{mine.todo} To do</strong> · <strong>{mine.doing} In progress</strong> · {mine.total} active</p>
 {assigneeError&&<p className="notice">{assigneeError}</p>}
 {moveNotice&&<p className="notice" role="status">{moveNotice}</p>}
 {error&&<p className="banner error" role="alert">{error}</p>}
 {editor&&<form className="card task-editor" onSubmit={e=>{e.preventDefault();void save(editor);}}><h3>{editor.id?'Edit task':'New task'}</h3><label>Title<input aria-label="Task title" required maxLength={160} value={editor.title??''} onChange={e=>setEditor({...editor,title:e.target.value})}/></label><label>Details<textarea aria-label="Task details" maxLength={4000} rows={4} value={editor.description??''} onChange={e=>setEditor({...editor,description:e.target.value})}/></label><div className="task-editor-options"><label>Status<select aria-label="Task status" value={editor.status} onChange={e=>setEditor({...editor,status:e.target.value as Todo['status']})}>{Object.entries(statuses).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label><label>Priority<select aria-label="Task priority" value={editor.priority} onChange={e=>setEditor({...editor,priority:e.target.value as Todo['priority']})}>{['low','normal','high'].map(v=><option key={v}>{v}</option>)}</select></label><label>Assignee<select aria-label="Task assignee" value={editor.assigneeId??(editor.assignee?'legacy':'')} onChange={e=>{const person=assignees.find(person=>person.id===e.target.value);setEditor({...editor,assigneeId:person?.id??'',assignee:person?.name??''});}}>
 <option value="">Unassigned</option>
 {editor.assignee&&!editor.assigneeId&&<option value="legacy" disabled>{editor.assignee} (legacy assignment)</option>}
 {editor.assigneeId&&!assignees.some(person=>person.id===editor.assigneeId)&&<option value={editor.assigneeId}>{editor.assignee} (currently unavailable)</option>}
 {assignees.map(person=><option key={person.id} value={person.id}>{person.name} · {person.rank}</option>)}
 </select></label></div><div className="board-actions"><button className="primary" disabled={busy}>Save task</button><button type="button" className="secondary" disabled={busy} onClick={()=>setEditor(null)}>Cancel</button></div></form>}
 <input className="board-search" aria-label="Search tasks" placeholder="Search tasks, details, or assignee…" value={query} onChange={e=>setQuery(e.target.value)}/>
 {!loaded?<p className="loading">Loading tasks…</p>:<div className="todo-columns">{Object.entries(statuses).map(([status,label])=><section className={'todo-column '+(over===status?'drop-target':'')} data-status={status} key={status} onDragOver={e=>{if(canMove&&dragged.current){e.preventDefault();e.dataTransfer.dropEffect='move';setOver(status);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setOver(null);}} onDrop={e=>{e.preventDefault();const id=dragged.current;endDrag();if(id)void move(id,status as Todo['status']);}}><header><h2>{label}</h2><span className="pill">{shown.filter(t=>t.status===status).length}</span></header>{shown.filter(t=>t.status===status).map(t=><article className={'card todo-task '+(dragging===t.id?'dragging':'')} key={t.id} draggable={canMove} onDragStart={e=>{if(!canMove||(e.target as HTMLElement).closest('button,a,input,select,textarea')){e.preventDefault();return;}dragged.current=t.id;setDragging(t.id);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.id);}} onDragEnd={endDrag}><div className="task-meta"><span className={'task-priority '+t.priority}>{t.priority}</span><small>{assigneeName(t)}</small></div><h3>{t.title}</h3>{t.description&&<p>{t.description}</p>}{t.source&&<a className="task-source" href={`https://discord.com/channels/${t.source.guildId}/${t.source.id}`} target="_blank" rel="noreferrer">↗ Discord suggestion</a>}<small>Updated {new Date(t.updatedAt).toLocaleDateString()}</small><div className="board-actions">{has(session,'todo.edit')&&<select className="task-move" aria-label={'Move '+t.title} disabled={!canMove} value={t.status} onChange={e=>void move(t.id,e.target.value as Todo['status'])}>{Object.entries(statuses).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select>}{has(session,'todo.edit')&&<button className="secondary small" disabled={busy} onClick={()=>setEditor({...t})}>Edit task</button>}{has(session,'todo.delete')&&<button className="danger small" disabled={busy} onClick={async()=>{if(!confirm('Delete this task?'))return;setBusy(true);try{await api('/todos/'+t.id+'/delete',{version:t.version});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Delete</button>}</div></article>)}{!shown.some(t=>t.status===status)&&<p className="empty">No tasks here yet.</p>}</section>)}</div>}
 </section>;
}
