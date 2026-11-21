import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Priority = 'high' | 'medium' | 'low';
type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
type Filter = 'all' | 'mine' | 'unassigned' | 'waiting' | 'overdue' | 'resolved';
type Agent = { id: string; email: string; display_name: string };
type Ticket = {
  id: string; code: string; subject: string; description: string; customer_name: string; customer_email: string;
  priority: Priority; status: TicketStatus; assignee_id: string | null; assignee_name?: string | null;
  response_due_at: string; resolution_due_at: string; created_at: string; updated_at: string;
  first_response_at?: string | null; resolved_at?: string | null; auto_close_at?: string | null; is_overdue: boolean; response_breached?: boolean; resolution_breached?: boolean;
};
type Message = { id: string; author: string; body: string; visibility: 'public' | 'internal'; created_at: string };
type Event = { id: string; action: string; actor: string; details: Record<string,string>; happened_at: string };
type Detail = { ticket: Ticket; messages: Message[]; events: Event[] };

type NewTicket = { subject: string; description: string; customer_name: string; customer_email: string; priority: Priority };
const emptyTicket: NewTicket = { subject: '', description: '', customer_name: '', customer_email: '', priority: 'medium' };
const filterItems: { value: Filter; title: string; icon: string }[] = [
  { value: 'all', title: 'All tickets', icon: '▦' }, { value: 'mine', title: 'Assigned to me', icon: '◎' },
  { value: 'unassigned', title: 'Unassigned', icon: '◌' }, { value: 'waiting', title: 'Waiting on customer', icon: '◷' },
  { value: 'overdue', title: 'Overdue', icon: '⚑' }, { value: 'resolved', title: 'Resolved', icon: '✓' }
];
const statusLabel: Record<TicketStatus,string> = { open:'Open', in_progress:'In progress', waiting_customer:'Waiting on customer', resolved:'Resolved', closed:'Closed' };
const formatter = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const displayDate = (iso?: string | null) => iso ? formatter.format(new Date(iso)) : '—';
function relative(iso: string) {
  const delta = new Date(iso).getTime() - Date.now();
  const amount = Math.abs(delta);
  const unit = amount < 3600000 ? `${Math.ceil(amount / 60000)}m` : amount < 86400000 ? `${Math.ceil(amount / 3600000)}h` : `${Math.ceil(amount / 86400000)}d`;
  return delta < 0 ? `${unit} overdue` : `in ${unit}`;
}

async function api<T>(path: string, token?: string | null, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(typeof data === 'object' && data && 'error' in data ? String((data as { error: string }).error) : 'Request failed');
  return data as T;
}
function Icon({ name, size = 19 }: { name: string; size?: number }) {
  const paths: Record<string,React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />, search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>, chevron: <path d="m9 18 6-6-6-6"/>,
    close: <path d="M6 6l12 12M18 6 6 18"/>, refresh: <><path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 4v7h-7"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    shield: <><path d="m12 2 8 4v6c0 5-3 8-8 10C7 20 4 17 4 12V6z"/><path d="m9 12 2 2 4-4"/></>,
    logout: <><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="m15 16 4-4-4-4M8 12h11"/></>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7z"/>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    check: <path d="m5 12 5 5L20 7" />
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" aria-hidden="true">{paths[name] || paths.bolt}</svg>;
}
function Mark() { return <div className="brandmark"><span className="brandmark-symbol">⌁</span><span>frontdesk<span className="brand-dot">.</span></span></div>; }
function PriorityPill({ priority }: { priority: Priority }) { return <span className={`priority priority-${priority}`}><span className="priority-dot" />{priority}</span>; }
function StatusPill({ status }: { status: TicketStatus }) { return <span className={`status status-${status}`}><span className="status-dot" />{statusLabel[status]}</span>; }
function Button({ children, onClick, type='button', variant='primary', disabled=false, className='' }: {
  children: React.ReactNode; onClick?: () => void; type?: 'submit'|'button'; variant?: 'primary'|'secondary'|'quiet'; disabled?: boolean; className?: string;
}) { return <button className={`btn btn-${variant} ${className}`} onClick={onClick} type={type} disabled={disabled}>{children}</button>; }

function Login({ onLogin }: { onLogin: (token: string, agent: Agent) => void }) {
  const [email, setEmail] = useState('asha@arvo.example');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try { const data = await api<{ agent: Agent; token: string }>('/auth/login', undefined, { method:'POST',body:JSON.stringify({email,password}) }); onLogin(data.token, data.agent); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="login-page"><div className="login-top"><Mark /><span>THE AGENT WORKSPACE</span></div><div className="login-wrap"><div className="login-promo"><span className="eyebrow">THE WORK GETS DONE HERE</span><h1>A calmer way to<br/><em>care for customers.</em></h1><p>One home for every conversation, deadline and handoff. Built to keep your whole support team in sync.</p><div className="login-metrics"><div><strong>09</strong><span>Support agents</span></div><div><strong>40+</strong><span>Daily conversations</span></div><div><strong>100%</strong><span>Activity visibility</span></div></div><div className="rings"><i/><i/><i/></div></div><div className="login-card"><div className="login-icon"><Icon name="lock" size={24}/></div><h2>Welcome back</h2><p>Sign in to your team workspace.</p><form onSubmit={handleLogin}><label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@arvo.example" required /></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password" required /></label>{error&&<div className="form-error">{error}</div>}<Button type="submit" disabled={busy}>{busy?'Signing in…':'Sign in to Frontdesk'} <Icon name="arrow" size={17}/></Button></form><div className="login-help">Demo account: <strong>asha@arvo.example</strong><br/>Use the password configured as <code>SEED_AGENT_PASSWORD</code>.</div></div></div><div className="login-footer">© 2026 Frontdesk by Arvo Systems <span>Built for the people behind support.</span></div></div>;
}
function TicketCreation({ onClose, onSubmit, error, busy }: { onClose:()=>void; onSubmit:(input:NewTicket)=>void; error:string; busy:boolean }) {
  const [form,setForm]=useState<NewTicket>(emptyTicket);
  const set = (key:keyof NewTicket, value:string) => setForm(prev => ({...prev, [key]:value}));
  return <div className="modal-backdrop" onMouseDown={e=>{ if(e.target === e.currentTarget)onClose(); }}><div className="modal"><div className="modal-header"><div><span className="eyebrow">START A CONVERSATION</span><h2>New support ticket</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div><form onSubmit={e=>{e.preventDefault();onSubmit(form);}}><div className="fields"><label>Subject<input value={form.subject} onChange={e=>set('subject',e.target.value)} placeholder="What needs attention?" minLength={3} maxLength={180} required /></label><label>Customer name<input value={form.customer_name} onChange={e=>set('customer_name',e.target.value)} placeholder="Full name" required /></label><label>Customer email<input type="email" value={form.customer_email} onChange={e=>set('customer_email',e.target.value)} placeholder="name@company.com" required /></label><label>Priority<select value={form.priority} onChange={e=>set('priority',e.target.value)}><option value="high">High — cannot work</option><option value="medium">Medium — needs attention</option><option value="low">Low — minor request</option></select></label><label>Issue description<textarea value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Describe the customer's issue…" rows={4} maxLength={5000} required /></label></div>{error&&<div className="form-error">{error}</div>}<div className="modal-footer"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}><Icon name="plus" size={17} />{busy?'Creating…':'Create ticket'}</Button></div></form></div></div>;
}
function DetailPanel({ data, agent, onClose, onMutate, notify }: { data:Detail;agent:Agent;onClose:()=>void;onMutate:()=>Promise<void>;notify:(s:string)=>void }) {
  const { ticket:t,messages,events } = data;
  const [tab,setTab] = useState<'conversation'|'activity'>('conversation');
  const [compose,setCompose] = useState<'public'|'internal'>('public');
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  const [priority,setPriority] = useState<Priority>(t.priority);
  useEffect(()=>{setPriority(t.priority);setTab('conversation');setMessage('');},[t.id]);
  const token = sessionStorage.getItem('frontdesk_token');
  const mine = String(t.assignee_id) === String(agent.id);
  const active = !['resolved','closed'].includes(t.status);
  const action = async (path:string, body?:unknown, success='Changes saved') => {
    setBusy(true);
    try { await api(`/tickets/${t.id}/${path}`,token,{method:'POST',body:JSON.stringify(body || {})}); notify(success); await onMutate(); }
    catch(e){ notify(`Error: ${(e as Error).message}`); } finally {setBusy(false);}
  };
  async function send() { if (!message.trim()) return; await action('messages',{body:message,visibility:compose},compose==='internal'?'Internal note added':'Reply sent');setMessage(''); }
  return <><div className="detail-scrim" onClick={onClose}/><aside className="detail-panel" aria-label="Ticket details"><div className="detail-header"><div className="detail-crumb">TICKETS <Icon name="chevron" size={13}/><strong>{t.code}</strong></div><button className="icon-button" onClick={onClose} aria-label="Close details"><Icon name="close" /></button></div><div className="detail-scroll"><div className="detail-main"><div className="detail-badges"><PriorityPill priority={t.priority}/><StatusPill status={t.status}/>{(t.is_overdue || t.response_breached || t.resolution_breached) && <span className="overdue-tag">SLA BREACHED</span>}</div><h2>{t.subject}</h2><p className="detail-desc">{t.description}</p><div className="customer"><div className="avatar customer-avatar">{t.customer_name.slice(0,1).toUpperCase()}</div><div><strong>{t.customer_name}</strong><span>{t.customer_email}</span></div><span className="customer-tag">CUSTOMER</span></div><div className="sla-panel"><div className="sla-title"><Icon name="clock" size={17}/>SLA commitments <span>IST</span></div><div className="sla-columns"><div><span>First response</span><strong className={!t.first_response_at && new Date(t.response_due_at) < new Date() && t.status !== 'waiting_customer' ? 'danger-text' : ''}>{t.first_response_at?'✓ Responded':displayDate(t.response_due_at)}</strong><small>{t.first_response_at?displayDate(t.first_response_at):relative(t.response_due_at)}</small></div><div><span>Resolution</span><strong>{displayDate(t.resolution_due_at)}</strong><small>{t.status==='waiting_customer'?'Timer paused':active?relative(t.resolution_due_at):'Clock stopped'}</small></div></div></div><div className="detail-meta"><div><span>Owner</span><strong>{t.assignee_name || (mine?agent.display_name:'Unassigned')}</strong></div><div><span>Created</span><strong>{displayDate(t.created_at)}</strong></div></div>
    {active && <div className="controls">{!t.assignee_id && <Button className="claim-btn" onClick={()=>action('claim',{},'Ticket assigned to you')} disabled={busy}><Icon name="user" size={17}/>Claim this ticket</Button>}{mine && <><div className="control-heading">MANAGE TICKET</div><div className="priority-picker"><select value={priority} onChange={e=>setPriority(e.target.value as Priority)} aria-label="Priority"><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select><Button variant="secondary" disabled={busy||priority===t.priority} onClick={()=>action('priority',{priority},'Priority updated')}>Update</Button></div><div className="status-buttons">{t.status!=='in_progress'&&<Button variant="secondary" disabled={busy} onClick={()=>action('status',{status:'in_progress'},'Moved to in progress')}>In progress</Button>}{t.status!=='waiting_customer'&&<Button variant="secondary" disabled={busy} onClick={()=>action('status',{status:'waiting_customer'},'Customer wait started')}>Wait on customer</Button>}<Button variant="secondary" disabled={busy} onClick={()=>action('status',{status:'resolved'},'Ticket resolved')}><Icon name="check" size={15}/>Resolve</Button></div></>}</div>}{t.status==='resolved'&&mine&&<Button onClick={()=>action('reopen',{},'Ticket reopened')} disabled={busy}><Icon name="refresh" size={16}/>Reopen ticket</Button>}
    </div><div className="detail-tabs"><button className={tab==='conversation'?'active':''} onClick={()=>setTab('conversation')}>Conversation <span>{messages.length}</span></button><button className={tab==='activity'?'active':''} onClick={()=>setTab('activity')}>Activity log <span>{events.length}</span></button></div>{tab==='conversation'?<div className="message-list">{!messages.length&&<div className="empty-conversation"><div className="empty-symbol">✉</div><strong>No messages yet</strong><span>Start the conversation below.</span></div>}{messages.map(m=><div className={`message-card ${m.visibility==='internal'?'internal-note':''}`} key={m.id}><div className="message-top"><strong>{m.author}</strong><span>{displayDate(m.created_at)}</span></div>{m.visibility==='internal'&&<span className="private-label"><Icon name="lock" size={12}/> Internal team note</span>}<p>{m.body}</p></div>)}</div>:<div className="timeline">{events.map(e=><div className="timeline-event" key={e.id}><div className="timeline-dot"/><div><strong>{e.action.replaceAll('_',' ')}</strong><p>{e.actor} · {displayDate(e.happened_at)}</p>{(e.details?.from||e.details?.to)&&<small>{e.details.from} → {e.details.to}</small>}</div></div>)}</div>}
    </div>{active && mine && <div className="composer"><div className="compose-toggle"><button onClick={()=>setCompose('public')} className={compose==='public'?'selected':''}><Icon name="send" size={15}/> Public reply</button><button onClick={()=>setCompose('internal')} className={compose==='internal'?'selected private':''}><Icon name="lock" size={15}/> Internal note</button></div><textarea rows={3} value={message} onChange={e=>setMessage(e.target.value)} placeholder={compose==='public'?'Write a reply to the customer…':'Only your team will see this note…'} maxLength={5000}/><div className="compose-bottom"><span>{compose==='internal'?'🔒 Private to agents only':'Visible to the customer'}</span><Button onClick={send} disabled={busy||!message.trim()}><Icon name="send" size={15}/>{busy?'Sending…':'Send'}</Button></div></div>}</aside></>;
}

function Dashboard({ token, agent, onLogout }: {token:string;agent:Agent;onLogout:()=>void}) {
  const [filter,setFilter] = useState<Filter>('all');
  const [search,setSearch] = useState('');
  const [tickets,setTickets] = useState<Ticket[]>([]);
  const [allTickets,setAllTickets] = useState<Ticket[]>([]);
  const [selected,setSelected] = useState<string|null>(null);
  const [detail,setDetail] = useState<Detail|null>(null);
  const [loading,setLoading] = useState(true);
  const [createOpen,setCreateOpen] = useState(false);
  const [formBusy,setFormBusy] = useState(false);
  const [formError,setFormError] = useState('');
  const [notice,setNotice] = useState('');
  const [customerToken,setCustomerToken]=useState('');
  const [mobileNav,setMobileNav]=useState(false);
  const notify = useCallback((s:string)=>setNotice(s),[]);
  const load = useCallback(async()=>{
    try {
      const [main, all] = await Promise.all([
        api<{tickets:Ticket[]}>(`/tickets?filter=${filter}&search=${encodeURIComponent(search)}`,token),
        api<{tickets:Ticket[]}>('/tickets?filter=all',token)
      ]);
      setTickets(main.tickets); setAllTickets(all.tickets);
      if (selected) {
        const updated = await api<Detail>(`/tickets/${selected}`,token);
        setDetail(updated);
      }
    } catch(e) { notify(`Error: ${(e as Error).message}`); }
    finally {setLoading(false);}
  },[filter,search,token,selected,notify]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{const timer=window.setInterval(()=>{void load();},60000);return()=>clearInterval(timer);},[load]);
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);},[notice]);
  const totals = useMemo(()=>({all:allTickets.length, open:allTickets.filter(t=>!['resolved','closed'].includes(t.status)).length, overdue:allTickets.filter(t=>t.is_overdue).length, waiting:allTickets.filter(t=>t.status==='waiting_customer').length}),[allTickets]);
  async function addTicket(input:NewTicket){setFormBusy(true);setFormError('');try {const result=await api<{ticket:Ticket;customer_access_token:string}>('/tickets',token,{method:'POST',body:JSON.stringify(input)});setCreateOpen(false);setCustomerToken(result.customer_access_token);notify(`${result.ticket.code} created`);await load();setSelected(String(result.ticket.id));}catch(e){setFormError((e as Error).message);}finally{setFormBusy(false);}}
  const heading = filterItems.find(i=>i.value===filter)?.title || 'All tickets';
  return <div className="app-shell"><aside className={`sidebar ${mobileNav?'mobile-open':''}`}><Mark/><div className="workspace-label">WORKSPACE</div><div className="nav-title">Overview</div><nav>{filterItems.map(item=><button key={item.value} onClick={()=>{setFilter(item.value);setMobileNav(false);}} className={filter===item.value?'nav-selected':''}><span className="nav-glyph">{item.icon}</span><span>{item.title}</span>{item.value==='overdue'&&totals.overdue>0&&<b className="nav-count">{totals.overdue}</b>}</button>)}</nav><div className="sidebar-lower"><div className="sidebar-help"><Icon name="shield" size={20}/><strong>Every action, accounted for.</strong><p>An audit trail you can trust. No lost context, no guesswork.</p></div><button className="profile" onClick={onLogout} title="Sign out"><span className="avatar">{agent.display_name[0]}</span><span><strong>{agent.display_name}</strong><small>Support agent · Sign out</small></span><Icon name="logout" size={17}/></button></div></aside>
    <main className="main"><header className="topbar"><div><button className="mobile-menu" onClick={()=>setMobileNav(!mobileNav)} aria-label="Open navigation">☰</button><span className="topbar-breadcrumb">Workspace</span><Icon name="chevron" size={15}/><strong>Support overview</strong></div><div className="topbar-right"><span className="operational"><span className="online-dot"/>Operational</span><span className="top-avatar">{agent.display_name[0]}</span></div></header><div className="main-content"><div className="heading-row"><div><span className="eyebrow">YOUR SUPPORT COMMAND CENTER</span><h1>Good {new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}, {agent.display_name.split(' ')[0]} <span className="greeting-star">✳</span></h1><p>Here's what's happening across your support queue.</p></div><Button onClick={()=>{setFormError('');setCreateOpen(true);}}><Icon name="plus" size={19}/>New ticket</Button></div>
      <div className="stats"><div className="stat"><div className="stat-icon stat-indigo">▦</div><span>Total tickets</span><div className="stat-value">{totals.all.toString().padStart(2,'0')}</div><small>Across your workspace</small></div><div className="stat"><div className="stat-icon stat-blue">◉</div><span>Active tickets</span><div className="stat-value">{totals.open.toString().padStart(2,'0')}</div><small>Awaiting resolution</small></div><div className="stat"><div className="stat-icon stat-red">⚑</div><span>Overdue</span><div className="stat-value">{totals.overdue.toString().padStart(2,'0')}</div><small>SLA needs attention</small></div><div className="stat"><div className="stat-icon stat-yellow">◷</div><span>Waiting on customer</span><div className="stat-value">{totals.waiting.toString().padStart(2,'0')}</div><small>SLA clock is paused</small></div></div>
      <div className="ticket-board"><div className="board-head"><div><h2>{heading}</h2><p>Manage and track customer conversations in one place.</p></div><button className="refresh-button" onClick={()=>{void load();}}><Icon name="refresh" size={17}/>Refresh</button></div><div className="board-toolbar"><div className="quick-filters">{(['all','mine','unassigned','waiting','overdue'] as Filter[]).map(item=><button key={item} className={filter===item?'quick-selected':''} onClick={()=>setFilter(item)}>{item==='all'?'All':item==='mine'?'My tickets':item==='unassigned'?'Unassigned':item==='waiting'?'Waiting':'Overdue'}</button>)}</div><label className="search-box"><Icon name="search" size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search tickets…" aria-label="Search tickets"/></label></div><div className="table-wrap"><table className="ticket-table"><thead><tr><th>Ticket</th><th>Priority</th><th>Status</th><th>Assigned to</th><th>Resolution SLA</th><th/></tr></thead><tbody>{tickets.map(t=><tr key={t.id} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setSelected(String(t.id));}} onClick={()=>setSelected(String(t.id))}><td><span className="ticket-code">{t.code}</span><strong className="ticket-subject">{t.subject}</strong><small>{t.customer_name} · {t.customer_email}</small></td><td><PriorityPill priority={t.priority}/></td><td><StatusPill status={t.status}/></td><td>{t.assignee_name||<span className="unassigned">Not assigned</span>}</td><td><span className={`due ${t.is_overdue?'due-late':''}`}>{t.status==='waiting_customer'?'Paused':t.is_overdue?'Overdue':relative(t.resolution_due_at)}</span><small className="due-date">{displayDate(t.resolution_due_at)}</small></td><td className="row-arrow"><Icon name="chevron" size={17}/></td></tr>)}</tbody></table>{loading&&<div className="empty-list">Loading tickets…</div>}{!loading&&!tickets.length&&<div className="empty-list"><div className="empty-graphic">✳</div><strong>No tickets here yet</strong><p>{search?'Try a different search.':'Your queue is clear. Create a ticket to get started.'}</p><Button variant="secondary" onClick={()=>setCreateOpen(true)}><Icon name="plus" size={17}/>Create a ticket</Button></div>}</div><div className="board-footer">Showing <strong>{tickets.length}</strong> of up to 200 matching tickets<span>All times in IST (GMT+5:30)</span></div></div>
      <div className="bottom-note"><Icon name="shield" size={16}/> Designed for clarity, accountability and better support. <span>Frontdesk v1.0</span></div>
    </div></main>{selected && detail?.ticket?.id && String(detail.ticket.id)===String(selected) && <DetailPanel data={detail} agent={agent} onClose={()=>{setSelected(null);setDetail(null);}} onMutate={load} notify={notify}/ >}
    {createOpen&&<TicketCreation onClose={()=>setCreateOpen(false)} onSubmit={addTicket} error={formError} busy={formBusy}/ >}
    {customerToken&&<div className="modal-backdrop"><div className="modal token-modal"><div className="modal-header"><div><span className="eyebrow">CUSTOMER ACCESS</span><h2>Ticket created successfully</h2></div></div><p>Copy this one-time customer access token. It allows the customer to view public ticket messages and reply through the customer API, but not private team notes. This token won't be shown again.</p><div className="token-value">{customerToken}</div><div className="modal-footer"><Button variant="secondary" onClick={()=>{void navigator.clipboard?.writeText(customerToken);notify('Token copied');}}><Icon name="copy" size={17}/>Copy token</Button><Button onClick={()=>setCustomerToken('')}>Done</Button></div></div></div>}
    {notice&&<div className={`toast ${notice.startsWith('Error:')?'toast-error':''}`} role="status">{notice}</div>}
    </div>;
}
function App() {
  const [token,setToken] = useState<string|null>(()=>sessionStorage.getItem('frontdesk_token'));
  const [agent,setAgent] = useState<Agent|null>(()=>{try {return JSON.parse(sessionStorage.getItem('frontdesk_agent')||'null') as Agent|null;}catch{return null;}});
  const login=(t:string,a:Agent)=>{sessionStorage.setItem('frontdesk_token',t);sessionStorage.setItem('frontdesk_agent',JSON.stringify(a));setToken(t);setAgent(a);};
  const logout=()=>{sessionStorage.removeItem('frontdesk_token');sessionStorage.removeItem('frontdesk_agent');setToken(null);setAgent(null);};
  return token&&agent?<Dashboard token={token} agent={agent} onLogout={logout}/>:<Login onLogin={login}/>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
