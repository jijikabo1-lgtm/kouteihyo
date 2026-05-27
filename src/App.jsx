import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react"
import { supabase } from "./supabaseClient"
import html2canvas from "html2canvas"

// ────────────────────────────────────────────────
// Constants & mapping
// ────────────────────────────────────────────────
const DAYS_JA = ["日","月","火","水","木","金","土"]

// Category list
const CATEGORIES = [
  { id:"green",  label:"建築",   en:"Architecture", color:"#3D8A4F" },
  { id:"yellow", label:"電気",   en:"Electrical",   color:"#B8960C" },
  { id:"blue",   label:"設備",   en:"Facility",     color:"#3B6FB0" },
  { id:"purple", label:"搬入",   en:"Delivery",     color:"#7B5BA8" },
  { id:"red",    label:"検査",   en:"Inspection",   color:"#B53A3A" },
  { id:"orange", label:"イベント",en:"Event",        color:"#D07030" },
  { id:"gray",   label:"その他", en:"Other",        color:"#6B7280" },
]
// HEXカラー（その他カスタム）にも対応: color が "#..." の場合はその他カテゴリ扱いだが色はそのまま使う
const catById = id => {
  if(id && id.startsWith('#')) return { ...CATEGORIES[CATEGORIES.length-1], color: id }
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length-1]
}
// カスタムカラー含めて「その他」グループに属するか判定（サイドバーフィルタ用）
const effectiveCatId = color => (color && color.startsWith('#')) ? 'gray' : (color || 'gray')



// ────────────────────────────────────────────────
// Date helpers
// ────────────────────────────────────────────────
const toKey    = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
const parseKey = k => { const [y,m,d]=k.split("-"); return new Date(+y,+m-1,+d) }
const addDays  = (d,n)=> new Date(d.getFullYear(), d.getMonth(), d.getDate()+n)
const diffDays = (a,b)=> Math.round((b-a)/86400000)
const fmtMD    = d => `${d.getMonth()+1}/${d.getDate()}`
const sameDay  = (a,b)=> toKey(a)===toKey(b)
const isWeekend= d => d.getDay()===0 || d.getDay()===6

// Half-day helpers: encode positions in 0.5-day units
// start_frac: 0 = morning start, 0.5 = afternoon start (half-day in)
// end_frac:   0 = evening end, 0.5 = noon end (half-day before evening)
const startHalf = (t, base) => diffDays(base, parseKey(t.start_key))*2 + (t.start_frac>=0.5?1:0)
const endHalf   = (t, base) => (diffDays(base, parseKey(t.end_key))+1)*2 - (t.end_frac>=0.5?1:0)
const halfToDayFrac = h => ({ day: Math.floor(h/2), frac: (h%2)===1 ? 0.5 : 0 })
const endHalfToDayFrac = h => ({ day: Math.floor((h-1)/2), frac: ((h-1)%2)===0 ? 0.5 : 0 })
// half position (h) for end means "end after halfH". end_day = day containing the last covered half. end_frac=0 means whole day, 0.5 means only morning

// ────────────────────────────────────────────────
// Assignee helpers
// ────────────────────────────────────────────────
function assigneeLabel(company, person) {
  const c=(company||"").trim(), p=(person||"").trim()
  if(c&&p) return `${c} ${p}`
  return c||p||""
}
function splitAssignee(str) {
  if(!str) return {company:"",person:""}
  const idx=str.lastIndexOf(" ")
  if(idx<0) return {company:"",person:str}
  return {company:str.slice(0,idx), person:str.slice(idx+1)}
}

// ────────────────────────────────────────────────
// Task layout (lane assignment)
// ────────────────────────────────────────────────
function layoutTasks(taskList, totalCols, base) {
  const placed = taskList.map(t=>{
    const s=diffDays(base,parseKey(t.start_key))
    const e=diffDays(base,parseKey(t.end_key))
    return {...t,col:s,endCol:e}
  }).filter(t=>t.endCol>=0&&t.col<totalCols)
  const lanes=[], result=[]
  for(const t of [...placed].sort((a,b)=>a.col-b.col)){
    let lane=lanes.findIndex(l=>(l[l.length-1]||{}).endCol<t.col)
    if(lane===-1){lane=lanes.length;lanes.push([])}
    lanes[lane].push({endCol:t.endCol})
    result.push({...t,lane})
  }
  return result
}

// ────────────────────────────────────────────────
// Global styles
// ────────────────────────────────────────────────
const CSS = `
:root{
  --bg:#F5F2EC;--surface:#FFFFFF;--surface-2:#FAF8F3;--surface-3:#EEEAE0;
  --border:#E2DDD2;--border-2:#D6CFC1;
  --text:#1B1D21;--text-2:#4B4F57;--text-3:#82858C;--text-4:#A7A9AF;
  --accent:#E4A11A;--accent-2:#C98A0E;--today:#FFF1C9;
  --sun:#B14848;--sat:#2F5DA0;
  --radius:8px;--radius-sm:6px;--radius-lg:12px;
  --shadow-sm:0 1px 2px rgba(20,18,12,.04),0 0 0 1px rgba(20,18,12,.04);
  --shadow:0 2px 6px rgba(20,18,12,.05),0 1px 2px rgba(20,18,12,.04);
  --shadow-lg:0 12px 32px rgba(20,18,12,.10),0 4px 12px rgba(20,18,12,.06);
  --font-sans:"IBM Plex Sans","Noto Sans JP",system-ui,-apple-system,sans-serif;
  --font-mono:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;
  --font-jp:"Noto Sans JP",system-ui,sans-serif;
}
[data-theme="dark"]{
  --bg:#0E1014;--surface:#161A21;--surface-2:#1C2129;--surface-3:#232932;
  --border:#2A303A;--border-2:#353C48;
  --text:#ECEEF2;--text-2:#B6BAC2;--text-3:#7D828B;--text-4:#5C616B;
  --today:#3A2E0E;
  --shadow-sm:0 1px 2px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.04);
  --shadow:0 4px 12px rgba(0,0,0,.4),0 1px 2px rgba(0,0,0,.3);
  --shadow-lg:0 16px 40px rgba(0,0,0,.5),0 4px 12px rgba(0,0,0,.3);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{height:100%;width:100%}
body{background:var(--bg);color:var(--text);font-family:var(--font-sans);font-size:13px;line-height:1.5;
  font-feature-settings:"palt";-webkit-font-smoothing:antialiased;overflow:hidden}
.mono{font-family:var(--font-mono);font-feature-settings:"tnum"}
.num{font-variant-numeric:tabular-nums}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border-2);border-radius:6px;border:2px solid var(--bg)}
::-webkit-scrollbar-thumb:hover{background:var(--text-4)}

button{font-family:inherit}
input,textarea,select{font-family:inherit}

@keyframes pulse{0%,100%{box-shadow:0 0 0 3px rgba(31,138,91,.15)}50%{box-shadow:0 0 0 5px rgba(31,138,91,.05)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideInL{from{transform:translateX(-100%)}to{transform:translateX(0)}}
@keyframes slideInR{from{transform:translateX(100%)}to{transform:translateX(0)}}
@keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}

/* Toast */
.kh-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#D42020;color:#fff;
  padding:10px 20px;border-radius:12px;font-size:13px;font-weight:600;z-index:999;
  box-shadow:0 4px 16px rgba(0,0,0,.3);animation:fadeIn .2s ease;font-family:var(--font-jp)}

/* Print preview & print */
body.kh-print-preview{overflow:auto !important;background:#ddd !important}
body.kh-print-preview #root{background:#fff;padding:20px 28px;max-width:1100px;margin:24px auto;
  box-shadow:0 10px 40px rgba(0,0,0,.15);min-height:calc(100vh - 48px);height:auto !important}
body.kh-print-preview header,
body.kh-print-preview .subheader,
body.kh-print-preview aside,
body.kh-print-preview nav[data-tabbar],
body.kh-print-preview [data-print="hide"]{display:none !important}
body.kh-print-preview .print-only{display:block !important}
body.kh-print-preview #root > div{display:block !important;height:auto !important;width:auto !important;overflow:visible !important}
body.kh-print-preview main{overflow:visible !important;height:auto !important;position:static !important;padding:0 !important}
body.kh-print-preview main *{overflow:visible !important;max-height:none !important}
.print-only{display:none}

/* ── Calendar print scaling: row heights grow as week-count shrinks ── */
body.kh-print-preview [data-weeks]{height:auto !important;overflow:visible !important}
body.kh-print-preview [data-weeks] > div{display:grid !important;flex:none !important;height:auto !important}
body.kh-print-preview [data-weeks="1"] > div{grid-template-rows:auto 600px !important}
body.kh-print-preview [data-weeks="2"] > div{grid-template-rows:auto 300px 300px !important}
body.kh-print-preview [data-weeks="3"] > div{grid-template-rows:auto repeat(3,200px) !important}
body.kh-print-preview [data-weeks="4"] > div{grid-template-rows:auto repeat(4,150px) !important}
body.kh-print-preview [data-weeks="5"] > div{grid-template-rows:auto repeat(5,120px) !important}

@media print{
  @page{margin:10mm;size:A4 landscape}
  html,body,#root{height:auto !important;width:auto !important;overflow:visible !important;
    background:#fff !important;color:#000 !important;
    -webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
  header,.subheader,aside,nav[data-tabbar],[data-print="hide"],.preview-bar{display:none !important}
  .print-only{display:block !important}
  #root > div{display:block !important;height:auto !important;overflow:visible !important}
  main{overflow:visible !important;height:auto !important;position:static !important;padding:0 !important}
  main *{overflow:visible !important;max-height:none !important}
  *{text-shadow:none !important;animation:none !important}
  /* Calendar: inner div becomes a grid, week rows get explicit heights */
  [data-weeks]{height:auto !important;overflow:visible !important}
  [data-weeks] > div{display:grid !important;flex:none !important;height:auto !important}
  [data-weeks="1"] > div{grid-template-rows:auto 155mm !important}
  [data-weeks="2"] > div{grid-template-rows:auto 77mm 77mm !important}
  [data-weeks="3"] > div{grid-template-rows:auto repeat(3,51mm) !important}
  [data-weeks="4"] > div{grid-template-rows:auto repeat(4,38mm) !important}
  [data-weeks="5"] > div{grid-template-rows:auto repeat(5,30mm) !important}
}
`

// ────────────────────────────────────────────────
// Toast hook
// ────────────────────────────────────────────────
function useToast() {
  const [msg, setMsg] = useState(null)
  const tRef = useRef(null)
  const show = useCallback((m)=> {
    setMsg(m)
    if(tRef.current) clearTimeout(tRef.current)
    tRef.current = setTimeout(()=>setMsg(null), 2400)
  }, [])
  return [msg, show]
}

// ────────────────────────────────────────────────
// Breakpoint hook
// ────────────────────────────────────────────────
function useBreakpoint() {
  const getBp = (w) => w < 768 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop'
  const [bp, setBp] = useState(()=> getBp(window.innerWidth))
  useEffect(()=>{
    const update = ()=> setBp(getBp(window.innerWidth))
    window.addEventListener('resize', update)
    return ()=> window.removeEventListener('resize', update)
  }, [])
  return bp
}

// ────────────────────────────────────────────────
// Icon component (SVG inline)
// ────────────────────────────────────────────────
function Icon({ name, size=16 }) {
  const paths = {
    gantt:    <><path d="M3 5h7M3 9h11M3 13h5M3 17h9" strokeWidth="1.6" strokeLinecap="round"/></>,
    calendar: <><rect x="3" y="4.5" width="14" height="13" rx="1.5" strokeWidth="1.4"/><path d="M3 8h14M7 3v3M13 3v3" strokeWidth="1.4" strokeLinecap="round"/></>,
    list:     <><circle cx="4.5" cy="6"  r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="14" r="1" fill="currentColor" stroke="none"/><path d="M8 6h9M8 10h9M8 14h9" strokeWidth="1.4" strokeLinecap="round"/></>,
    agenda:   <><path d="M5 4h10M5 8h10M5 12h6M5 16h8" strokeWidth="1.5" strokeLinecap="round"/><circle cx="3" cy="4" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="16" r=".8" fill="currentColor" stroke="none"/></>,
    print:    <><path d="M6 5V3h8v2M5 7h10a1 1 0 0 1 1 1v5h-2v3H6v-3H4V8a1 1 0 0 1 1-1Z" strokeWidth="1.4" strokeLinejoin="round"/></>,
    plus:     <><path d="M10 4v12M4 10h12" strokeWidth="1.6" strokeLinecap="round"/></>,
    search:   <><circle cx="9" cy="9" r="5.5" strokeWidth="1.5"/><path d="m13 13 3.5 3.5" strokeWidth="1.5" strokeLinecap="round"/></>,
    chevL:    <><path d="m12 4-5 6 5 6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>,
    chevR:    <><path d="m8 4 5 6-5 6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>,
    menu:     <><path d="M3 6h14M3 10h14M3 14h14" strokeWidth="1.6" strokeLinecap="round"/></>,
    close:    <><path d="m5 5 10 10M15 5 5 15" strokeWidth="1.6" strokeLinecap="round"/></>,
    check:    <><path d="m4 10 4 4 8-8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></>,
    sun:      <><circle cx="10" cy="10" r="3.5" strokeWidth="1.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" strokeWidth="1.4" strokeLinecap="round"/></>,
    moon:     <><path d="M16 11a6 6 0 1 1-7-7 5 5 0 0 0 7 7Z" strokeWidth="1.5" strokeLinejoin="round"/></>,
    trash:    <><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/></>,
    edit:     <><path d="M4 14v2h2l9-9-2-2-9 9Z" strokeWidth="1.4" strokeLinejoin="round"/></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" style={{flexShrink:0}}>
      {paths[name]}
    </svg>
  )
}

// ────────────────────────────────────────────────
// IconButton
// ────────────────────────────────────────────────
function IconButton({ icon, label, onClick, primary, active, size=32, title }) {
  return (
    <button onClick={onClick} title={title||label} aria-label={title||label}
      style={{
        display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,
        height:size,minWidth:size,padding:label?'0 12px':0,
        background:primary?'var(--accent)':(active?'var(--surface-3)':'transparent'),
        color:primary?'#fff':(active?'var(--text)':'var(--text-2)'),
        border:primary?'1px solid var(--accent-2)':'1px solid transparent',
        borderRadius:7,cursor:'pointer',fontSize:12,fontWeight:500,fontFamily:'var(--font-jp)',
        transition:'all .12s ease',whiteSpace:'nowrap',
      }}
      onMouseEnter={e=>{if(!primary&&!active)e.currentTarget.style.background='var(--surface-3)'}}
      onMouseLeave={e=>{if(!primary&&!active)e.currentTarget.style.background='transparent'}}
    >
      {icon && <Icon name={icon} size={15}/>}
      {label}
    </button>
  )
}

// ────────────────────────────────────────────────
// Header
// ────────────────────────────────────────────────
function Header({ bp, view, setView, search, setSearch, onOpenDrawer, onAdd, onPrint, onToggleTheme, theme, viewOptions, searchExpanded, setSearchExpanded, currentProject, onBack }) {
  return (
    <header style={{
      gridArea:'header',display:'flex',alignItems:'center',
      padding:bp==='mobile'?'0 12px':'0 20px',
      background:'var(--surface)',borderBottom:'1px solid var(--border)',
      gap:bp==='mobile'?8:14,height:bp==='mobile'?52:52,flexShrink:0,
    }}>
      {bp!=='desktop' && !currentProject && (
        <IconButton icon="menu" onClick={onOpenDrawer} title="メニュー"/>
      )}

      {!searchExpanded && (
        <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0,flex:1}}>
          {currentProject ? (
            <>
              <button onClick={onBack}
                style={{display:'inline-flex',alignItems:'center',gap:3,height:30,padding:'0 8px',
                  background:'transparent',border:'1px solid var(--border)',borderRadius:6,cursor:'pointer',
                  color:'var(--text-2)',fontSize:12,fontFamily:'var(--font-jp)',flexShrink:0,
                  transition:'all .12s ease'}}
                onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <Icon name="chevL" size={13}/>
                {bp!=='mobile' && '一覧'}
              </button>
              <div style={{width:1,height:20,background:'var(--border)',flexShrink:0}}/>
              <div style={{width:28,height:28,borderRadius:6,background:'var(--accent)',color:'#fff',
                display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:13,
                fontFamily:'var(--font-jp)',flexShrink:0}}>工</div>
              <div style={{display:'flex',flexDirection:'column',gap:0,minWidth:0,flex:1}}>
                <span style={{fontSize:bp==='mobile'?13:13.5,fontWeight:600,fontFamily:'var(--font-jp)',
                  whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{currentProject.name}</span>
                {currentProject.code && (
                  <span style={{fontSize:10,color:'var(--text-3)',fontFamily:'var(--font-mono)',letterSpacing:'.04em'}}>{currentProject.code}</span>
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{width:28,height:28,borderRadius:6,background:'var(--text)',color:'var(--surface)',
                display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:13,
                fontFamily:'var(--font-jp)',flexShrink:0}}>工</div>
              <div style={{display:'flex',flexDirection:'column',gap:1,minWidth:0,flex:1}}>
                <span style={{fontSize:bp==='mobile'?13:13.5,fontWeight:600,fontFamily:'var(--font-jp)',
                  whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>工程表</span>
                <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10.5,color:'#1F8A5B'}}>
                  <span style={{width:6,height:6,borderRadius:'50%',background:'#1F8A5B',
                    boxShadow:'0 0 0 3px rgba(31,138,91,.15)',animation:'pulse 2s infinite'}}/>
                  LIVE
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {searchExpanded && (
        <div style={{flex:1,display:'flex',alignItems:'center',gap:6}}>
          <Icon name="search" size={16}/>
          <input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="検索"
            style={{flex:1,height:32,padding:'0 8px',background:'transparent',border:'none',outline:'none',
              fontSize:14,color:'var(--text)',fontFamily:'var(--font-jp)'}}/>
          <IconButton icon="close" onClick={()=>{setSearch('');setSearchExpanded(false)}}/>
        </div>
      )}

      {!searchExpanded && bp==='desktop' && (
        <div style={{position:'relative',width:280}}>
          <div style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',pointerEvents:'none'}}>
            <Icon name="search" size={14}/>
          </div>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="タスク・担当・工種で検索"
            style={{width:'100%',height:32,padding:'0 12px 0 32px',background:'var(--surface-2)',
              border:'1px solid var(--border)',borderRadius:6,fontSize:12,color:'var(--text)',
              fontFamily:'var(--font-jp)',outline:'none'}}
            onFocus={e=>e.currentTarget.style.borderColor='var(--accent)'}
            onBlur={e=>e.currentTarget.style.borderColor='var(--border)'}/>
        </div>
      )}

      {!searchExpanded && bp!=='desktop' && (
        <IconButton icon="search" onClick={()=>setSearchExpanded(true)}/>
      )}

      {!searchExpanded && (bp==='desktop'||bp==='tablet') && (
        <ViewSwitcher view={view} setView={setView} options={viewOptions} showLabel={bp==='desktop'}/>
      )}

      {!searchExpanded && (
        <>
          <IconButton icon={theme==='dark'?'sun':'moon'} onClick={onToggleTheme} title={theme==='dark'?'ライトモード':'ダークモード'}/>
          {bp==='desktop' && <div style={{width:1,height:24,background:'var(--border)'}}/>}
          <IconButton icon="print" label={bp==='desktop'?'印刷':null} onClick={onPrint}/>
          <IconButton icon="plus" label={bp==='desktop'?'タスク追加':null} primary onClick={onAdd}/>
        </>
      )}
    </header>
  )
}

// ────────────────────────────────────────────────
// ViewSwitcher
// ────────────────────────────────────────────────
function ViewSwitcher({ view, setView, options, showLabel }) {
  return (
    <div style={{display:'flex',padding:2,background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:8}}>
      {options.map(v=>(
        <button key={v.id} onClick={()=>setView(v.id)} title={v.label}
          style={{
            display:'inline-flex',alignItems:'center',gap:5,
            padding:showLabel?'4px 10px':0,width:showLabel?'auto':30,height:26,
            background:view===v.id?'var(--surface)':'transparent',
            color:view===v.id?'var(--text)':'var(--text-3)',
            border:'none',boxShadow:view===v.id?'var(--shadow-sm)':'none',
            borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:500,
            fontFamily:'var(--font-jp)',transition:'all .12s ease',justifyContent:'center',
          }}>
          <Icon name={v.icon} size={14}/>
          {showLabel && v.label}
        </button>
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────
// Sidebar content
// ────────────────────────────────────────────────
function SidebarContent({ activeCats, setActiveCats, tasks, onClose }) {
  const stats = useMemo(()=>{
    const total = tasks.length
    const done = tasks.filter(t=>t.done).length
    const upcoming = total - done
    return { total, done, upcoming }
  }, [tasks])

  const toggleCat = id => setActiveCats(s => s.includes(id) ? s.filter(c=>c!==id) : [...s,id])
  const catCounts = useMemo(()=>{
    const m={}
    // HEXカラーのタスクは「その他」(gray)にカウント
    tasks.forEach(t=>{ const k=effectiveCatId(t.color); m[k]=(m[k]||0)+1 })
    return m
  }, [tasks])

  return (
    <>
      <div style={{padding:'14px 16px 12px',borderBottom:'1px solid var(--border)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',color:'var(--text-3)'}}>進捗</div>
          {onClose && <button onClick={onClose} style={{background:'transparent',border:'none',cursor:'pointer',color:'var(--text-3)',width:24,height:24,display:'inline-flex',alignItems:'center',justifyContent:'center',borderRadius:5}}><Icon name="close" size={14}/></button>}
        </div>
        <div style={{display:'flex',alignItems:'baseline',gap:4,marginBottom:8}}>
          <span className="mono num" style={{fontSize:26,fontWeight:600,lineHeight:1,color:'var(--text)'}}>{Math.round((stats.done/Math.max(1,stats.total))*100)}</span>
          <span style={{fontSize:12,color:'var(--text-3)'}}>%</span>
          <span style={{marginLeft:'auto',fontSize:10.5,color:'var(--text-3)',fontFamily:'var(--font-jp)'}}>{stats.done}/{stats.total}</span>
        </div>
        <div style={{display:'flex',height:5,borderRadius:3,overflow:'hidden',background:'var(--surface-3)'}}>
          <div style={{width:`${(stats.done/Math.max(1,stats.total))*100}%`,background:'#1F8A5B'}}/>
        </div>
      </div>

      <div style={{padding:'12px 16px 14px',flex:1,overflowY:'auto',minHeight:0}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',color:'var(--text-3)'}}>工種</div>
          <button onClick={()=>setActiveCats(activeCats.length?[]:CATEGORIES.map(c=>c.id))}
            style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-3)',fontSize:10.5,fontFamily:'var(--font-jp)'}}>
            {activeCats.length?'クリア':'全選択'}
          </button>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:1}}>
          {CATEGORIES.map(c=>{
            const active = activeCats.length===0 || activeCats.includes(c.id)
            return (
              <button key={c.id} onClick={()=>toggleCat(c.id)}
                style={{display:'flex',alignItems:'center',gap:8,padding:'6px 6px',margin:'0 -6px',
                  background:'transparent',border:'none',borderRadius:5,cursor:'pointer',textAlign:'left',
                  opacity:active?1:.4,transition:'all .1s ease'}}>
                <span style={{width:10,height:10,borderRadius:3,background:c.color,flexShrink:0,boxShadow:'inset 0 0 0 1px rgba(0,0,0,.06)'}}/>
                <span style={{fontSize:12,fontFamily:'var(--font-jp)',fontWeight:500,color:'var(--text)'}}>{c.label}</span>
                <span style={{fontSize:10,color:'var(--text-4)',fontFamily:'var(--font-jp)'}}>{c.en}</span>
                <span className="mono num" style={{marginLeft:'auto',fontSize:10.5,color:'var(--text-3)'}}>{catCounts[c.id]||0}</span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

function Sidebar(props) {
  return (
    <aside style={{gridArea:'sidebar',borderRight:'1px solid var(--border)',background:'var(--surface)',
      overflowY:'auto',display:'flex',flexDirection:'column'}}>
      <SidebarContent {...props}/>
    </aside>
  )
}

function SidebarDrawer({ open, onClose, ...props }) {
  if(!open) return null
  return (
    <div style={{position:'fixed',inset:0,zIndex:80,display:'flex',animation:'fadeIn .15s ease'}}>
      <div onClick={onClose} style={{position:'absolute',inset:0,background:'rgba(20,18,12,.4)',backdropFilter:'blur(2px)'}}/>
      <div style={{position:'relative',width:'min(320px,86vw)',background:'var(--surface)',
        boxShadow:'var(--shadow-lg)',display:'flex',flexDirection:'column',overflowY:'auto',
        animation:'slideInL .2s ease'}}>
        <SidebarContent {...props} onClose={onClose}/>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────
// SubHeader (date controls)
// ────────────────────────────────────────────────
function SubHeader({ rangeStart, setRangeStart, rangeDays, setRangeDays, bp }) {
  const start = parseKey(rangeStart)
  const end = addDays(start, rangeDays-1)
  const shift = dir => setRangeStart(toKey(addDays(start, dir*7)))
  const goToday = () => setRangeStart(toKey(addDays(new Date(), -3)))
  const dayOptions = [7,14,28]

  return (
    <div data-print="hide" className="subheader" style={{
      gridArea:'subheader',display:'flex',alignItems:'center',
      padding:bp==='mobile'?'0 12px':'0 20px',gap:bp==='mobile'?8:12,
      background:'var(--surface)',borderBottom:'1px solid var(--border)',
      height:bp==='mobile'?44:44,flexShrink:0,overflowX:'auto',
    }}>
      <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
        <button onClick={()=>shift(-1)} aria-label="前週"
          style={{width:30,height:30,padding:0,background:'transparent',border:'1px solid var(--border)',
            borderRadius:6,cursor:'pointer',color:'var(--text-2)',display:'inline-flex',
            alignItems:'center',justifyContent:'center'}}>
          <Icon name="chevL" size={14}/>
        </button>
        <button onClick={goToday}
          style={{height:30,padding:'0 10px',background:'var(--surface)',border:'1px solid var(--border)',
            borderRadius:6,cursor:'pointer',fontSize:11.5,fontWeight:500,color:'var(--text-2)',
            fontFamily:'var(--font-jp)'}}>今日</button>
        <button onClick={()=>shift(1)} aria-label="次週"
          style={{width:30,height:30,padding:0,background:'transparent',border:'1px solid var(--border)',
            borderRadius:6,cursor:'pointer',color:'var(--text-2)',display:'inline-flex',
            alignItems:'center',justifyContent:'center'}}>
          <Icon name="chevR" size={14}/>
        </button>
      </div>

      <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
        <span className="mono" style={{fontSize:bp==='mobile'?13:14,fontWeight:500,color:'var(--text)'}}>{fmtMD(start)}</span>
        <span style={{color:'var(--text-4)'}}>—</span>
        <span className="mono" style={{fontSize:bp==='mobile'?13:14,fontWeight:500,color:'var(--text)'}}>{fmtMD(end)}</span>
        {bp!=='mobile' && (
          <span style={{fontSize:11,color:'var(--text-3)',fontFamily:'var(--font-jp)',marginLeft:4}}>{start.getFullYear()}年</span>
        )}
      </div>

      <div style={{width:1,height:20,background:'var(--border)',margin:'0 2px',flexShrink:0}}/>

      <div style={{display:'flex',padding:2,background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:6,flexShrink:0}}>
        {dayOptions.map(d=>(
          <button key={d} onClick={()=>setRangeDays(d)}
            style={{padding:'2px 10px',height:24,
              background:rangeDays===d?'var(--accent)':'transparent',
              color:rangeDays===d?'#fff':'var(--text-3)',
              border:'none',borderRadius:4,cursor:'pointer',fontSize:11.5,fontWeight:500,
              fontFamily:'var(--font-jp)',transition:'all .12s ease'}}>{d}日</button>
        ))}
      </div>

      <div style={{flex:1}}/>
    </div>
  )
}

// ────────────────────────────────────────────────
// BottomTabBar (mobile)
// ────────────────────────────────────────────────
function BottomTabBar({ view, setView, options }) {
  return (
    <nav data-tabbar style={{
      gridArea:'tabbar',display:'flex',background:'var(--surface)',
      borderTop:'1px solid var(--border)',height:56,
      paddingBottom:'env(safe-area-inset-bottom,0px)',flexShrink:0,
    }}>
      {options.map(v=>{
        const active = view===v.id
        return (
          <button key={v.id} onClick={()=>setView(v.id)}
            style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
              gap:3,background:'transparent',border:'none',cursor:'pointer',
              color:active?'var(--accent-2)':'var(--text-3)',padding:'6px 0',
              transition:'color .12s ease'}}>
            <Icon name={v.icon} size={18}/>
            <span style={{fontSize:10,fontWeight:600,fontFamily:'var(--font-jp)'}}>{v.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

// ────────────────────────────────────────────────
// Gantt View (task-row layout with label column)
// ────────────────────────────────────────────────
const GanttView = memo(function GanttView({ tasks, rangeStart, rangeDays, bp, onSelect, resizeTask, toggleDone }) {
  const base = parseKey(rangeStart)
  const colDates = useMemo(()=> Array.from({length:rangeDays},(_,i)=>addDays(base,i)), [rangeStart,rangeDays])
  const chartRef = useRef(null)
  const [chartW, setChartW] = useState(0)
  const [pendingResize, setPendingResize] = useState(null)
  const dragRef = useRef(null)

  useEffect(()=>{
    if(!chartRef.current) return
    const ro = new ResizeObserver(entries=>{
      for(const e of entries) setChartW(e.contentRect.width)
    })
    ro.observe(chartRef.current)
    return ()=> ro.disconnect()
  }, [])

  const LABEL_W = bp==='mobile'? 130 : (bp==='tablet'? 200 : 240)
  const ROW_H   = bp==='mobile'? 36 : 40
  const GROUP_H = bp==='mobile'? 30 : 32
  const minDayW = bp==='mobile'? 38 : 44
  const dayW = chartW > 0 ? Math.max(minDayW, chartW / rangeDays) : minDayW
  const totalChartW = dayW * rangeDays
  const today = new Date(); today.setHours(0,0,0,0)
  const todayCol = diffDays(base, today)

  // Group tasks by category, sorted by start date within group
  const grouped = useMemo(()=>{
    const map = {}
    CATEGORIES.forEach(c=>{ map[c.id]=[] })
    tasks.forEach(t=>{ if(map[t.color]) map[t.color].push(t) })
    Object.values(map).forEach(arr => arr.sort((a,b)=> a.start_key.localeCompare(b.start_key)))
    return CATEGORIES.map(c=>({cat:c, tasks:map[c.id]})).filter(g=>g.tasks.length>0)
  }, [tasks])

  // Apply pending resize
  const displayTask = useCallback(t => {
    if(pendingResize && pendingResize.id===t.id){
      return {...t,
        start_key:pendingResize.startKey, end_key:pendingResize.endKey,
        start_frac:pendingResize.startFrac, end_frac:pendingResize.endFrac}
    }
    return t
  }, [pendingResize])

  const startResize = useCallback((e, task, edge)=>{
    e.stopPropagation(); e.preventDefault()
    const halfW = dayW / 2
    const startX = e.touches ? e.touches[0].clientX : e.clientX
    const origStartHalf = startHalf(task, base)
    const origEndHalf   = endHalf(task, base)
    dragRef.current = { edge, origTask: task, halfW, startX, origStartHalf, origEndHalf }

    const onMove = ev => {
      const d = dragRef.current; if(!d) return
      const x = ev.touches ? ev.touches[0].clientX : ev.clientX
      const dx = x - d.startX
      const deltaHalf = Math.round(dx / d.halfW)
      if(d.edge==='left'){
        const newStartHalf = Math.min(d.origStartHalf + deltaHalf, d.origEndHalf - 1)
        const {day:sDay, frac:sFrac} = halfToDayFrac(newStartHalf)
        d.startKey = toKey(addDays(base, sDay))
        d.startFrac = sFrac
        d.endKey = d.origTask.end_key
        d.endFrac = d.origTask.end_frac || 0
      } else {
        const newEndHalf = Math.max(d.origEndHalf + deltaHalf, d.origStartHalf + 1)
        const {day:eDay, frac:eFrac} = endHalfToDayFrac(newEndHalf)
        d.startKey = d.origTask.start_key
        d.startFrac = d.origTask.start_frac || 0
        d.endKey = toKey(addDays(base, eDay))
        d.endFrac = eFrac
      }
      setPendingResize({ id: d.origTask.id, startKey:d.startKey, endKey:d.endKey, startFrac:d.startFrac, endFrac:d.endFrac })
    }
    const onUp = () => {
      const d = dragRef.current
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      if(d){
        const changed = d.startKey !== d.origTask.start_key
          || d.endKey   !== d.origTask.end_key
          || (d.startFrac||0) !== (d.origTask.start_frac||0)
          || (d.endFrac||0)   !== (d.origTask.end_frac||0)
        if(changed){
          resizeTask(d.origTask.id, d.startKey, d.endKey, d.startFrac, d.endFrac)
        }
      }
      dragRef.current = null
      setPendingResize(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, {passive:false})
    window.addEventListener('touchend', onUp)
  }, [dayW, base, resizeTask])

  // Flatten rows with group headers for unified scrolling
  const flatRows = useMemo(()=>{
    const rows = []
    grouped.forEach(g => {
      rows.push({type:'group', cat:g.cat, count:g.tasks.length})
      g.tasks.forEach(t => rows.push({type:'task', task:t, cat:g.cat}))
    })
    return rows
  }, [grouped])

  // Calculate dynamic row stretch to fill viewport
  // We don't want to artificially stretch tasks; use min content height
  const taskRowCount = flatRows.filter(r => r.type==='task').length

  const DateHeader = () => (
    <div style={{display:'flex',background:'var(--surface)',borderBottom:'1px solid var(--border)',
      height:bp==='mobile'?44:48,flexShrink:0,position:'sticky',top:0,zIndex:20}}>
      <div style={{width:LABEL_W,padding:'0 14px',borderRight:'1px solid var(--border)',
        display:'flex',alignItems:'center',background:'var(--surface)'}}>
        <span style={{fontSize:10,fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
          color:'var(--text-3)',fontFamily:'var(--font-jp)'}}>タスク</span>
        <span className="mono num" style={{marginLeft:'auto',fontSize:11,color:'var(--text-3)'}}>{taskRowCount}</span>
      </div>
      <div style={{flex:1,display:'grid',gridTemplateColumns:`repeat(${rangeDays},1fr)`,minWidth:totalChartW}}>
        {colDates.map((d,i)=>{
          const isT = sameDay(d, today)
          const we = isWeekend(d)
          return (
            <div key={i} style={{
              borderRight:'1px solid var(--border)',padding:'4px 2px',
              background:isT?'var(--today)':(we?(d.getDay()===0?'rgba(177,72,72,.05)':'rgba(47,93,160,.05)'):'transparent'),
              display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
            }}>
              <span style={{fontSize:9,fontWeight:600,letterSpacing:'.04em',
                color:d.getDay()===0?'var(--sun)':(d.getDay()===6?'var(--sat)':'var(--text-3)'),
                fontFamily:'var(--font-jp)'}}>{DAYS_JA[d.getDay()]}</span>
              <span className="mono num" style={{fontSize:bp==='mobile'?13:14,fontWeight:600,lineHeight:1.1,
                color:d.getDay()===0?'var(--sun)':(d.getDay()===6?'var(--sat)':(isT?'var(--accent-2)':'var(--text)'))}}>{d.getDate()}</span>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div style={{height:'100%',width:'100%',display:'flex',flexDirection:'column',
      background:'var(--bg)',overflow:'hidden'}}>
      <div style={{flex:1,overflow:'auto',background:'var(--surface)'}}>
        <DateHeader/>
        {tasks.length===0 ? (
          <div style={{padding:'80px 20px',textAlign:'center',color:'var(--text-3)',fontFamily:'var(--font-jp)'}}>
            タスクがありません
          </div>
        ) : (
          <div style={{position:'relative'}}>
            {flatRows.map((row, idx) => {
              if(row.type === 'group'){
                return (
                  <div key={`g-${row.cat.id}`} style={{
                    display:'flex',height:GROUP_H,background:'var(--surface-2)',
                    borderBottom:'1px solid var(--border)',borderTop:idx>0?'1px solid var(--border-2)':'none',
                    position:'sticky',top:bp==='mobile'?44:48,zIndex:10,
                  }}>
                    <div style={{width:LABEL_W,padding:bp==='mobile'?'0 10px':'0 14px',borderRight:'1px solid var(--border)',
                      display:'flex',alignItems:'center',gap:7,background:'var(--surface-2)',
                      whiteSpace:'nowrap',overflow:'hidden'}}>
                      <span style={{width:10,height:10,borderRadius:2,background:row.cat.color,flexShrink:0,
                        boxShadow:'inset 0 0 0 1px rgba(0,0,0,.06)'}}/>
                      <span style={{fontSize:12,fontWeight:700,color:'var(--text)',fontFamily:'var(--font-jp)',flexShrink:0}}>{row.cat.label}</span>
                      {bp!=='mobile' && <span style={{fontSize:10,color:'var(--text-4)',fontFamily:'var(--font-jp)',overflow:'hidden',textOverflow:'ellipsis'}}>{row.cat.en}</span>}
                      <span className="mono num" style={{marginLeft:'auto',fontSize:10.5,color:'var(--text-3)',fontWeight:600,flexShrink:0}}>{row.count}</span>
                    </div>
                    <div style={{flex:1,minWidth:totalChartW}}/>
                  </div>
                )
              }
              const t = displayTask(row.task)
              const cat = row.cat
              const sCol = diffDays(base, parseKey(t.start_key))
              const eCol = diffDays(base, parseKey(t.end_key))
              const sFrac = t.start_frac >= 0.5 ? 0.5 : 0
              const eFrac = t.end_frac >= 0.5 ? 0.5 : 0
              const visible = eCol >= 0 && sCol < rangeDays
              const startPos = sCol + sFrac
              const endPos   = eCol + 1 - eFrac
              const left  = Math.max(0, startPos) * dayW
              const right = Math.min(rangeDays, endPos) * dayW
              const width = Math.max(dayW*0.25, right - left)
              const hasMemo = !!(t.memo && t.memo.trim())
              const MEMO_H = bp==='mobile' ? 14 : 15
              const thisRowH = hasMemo ? ROW_H + MEMO_H : ROW_H
              const BAR_H = ROW_H - 14
              return (
                <div key={`t-${t.id}`} style={{display:'flex',height:thisRowH,borderBottom:'1px solid var(--border)',
                  transition:'background .1s ease'}}
                  onMouseEnter={e => e.currentTarget.style.background='var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  {/* Label column */}
                  <div onClick={()=>onSelect(t)} style={{
                    width:LABEL_W,padding:bp==='mobile'?'0 8px 0 10px':'0 10px 0 14px',borderRight:'1px solid var(--border)',
                    display:'flex',alignItems:'center',gap:7,cursor:'pointer',
                    background:'inherit'}}>
                    <button onClick={e=>{e.stopPropagation();toggleDone(t.id,!t.done)}}
                      style={{width:18,height:18,borderRadius:'50%',
                        border:`2px solid ${t.done?'#1F8A5B':'var(--text-4)'}`,
                        background:t.done?'#1F8A5B':'transparent',cursor:'pointer',padding:0,
                        display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',flexShrink:0}}>
                      {t.done && <Icon name="check" size={10}/>}
                    </button>
                    <span style={{width:3,height:18,borderRadius:2,background:cat.color,flexShrink:0}}/>
                    <div style={{minWidth:0,flex:1,display:'flex',flexDirection:'column',gap:1}}>
                      <span style={{fontSize:bp==='mobile'?12:12.5,fontWeight:600,fontFamily:'var(--font-jp)',
                        color:'var(--text)',textDecoration:t.done?'line-through':'none',
                        opacity:t.done?.55:1,
                        overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:1.25}}>{t.text}</span>
                      {t.assignee && (
                        <span style={{fontSize:10,color:'var(--text-3)',fontFamily:'var(--font-jp)',
                          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:1.2}}>{t.assignee}</span>
                      )}
                    </div>
                  </div>
                  {/* Chart cell */}
                  <div ref={idx===0||chartRef.current==null ? chartRef : null}
                    style={{flex:1,position:'relative',minWidth:totalChartW,
                      background:'inherit'}}>
                    {/* Grid columns */}
                    <div style={{position:'absolute',inset:0,display:'grid',
                      gridTemplateColumns:`repeat(${rangeDays},1fr)`,pointerEvents:'none'}}>
                      {colDates.map((d,i)=>{
                        const we = isWeekend(d)
                        const isT = sameDay(d, today)
                        return (
                          <div key={i} style={{
                            borderRight:'1px dashed var(--border)',
                            background:isT?'rgba(228,161,26,.06)':(we?'rgba(0,0,0,.018)':'transparent'),
                          }}/>
                        )
                      })}
                    </div>
                    {/* Today line */}
                    {todayCol>=0 && todayCol<rangeDays && (
                      <div style={{position:'absolute',top:0,bottom:0,
                        left:`${(todayCol+0.5)*dayW}px`,
                        width:2,background:'var(--accent)',pointerEvents:'none',zIndex:5,opacity:.6}}/>
                    )}
                    {/* Bar */}
                    {visible && (
                      <div onClick={()=>onSelect(t)} style={{
                        position:'absolute',left,top:(ROW_H-BAR_H)/2,width,height:BAR_H,
                        background:cat.color,borderRadius:5,cursor:'pointer',
                        display:'flex',alignItems:'center',padding:'0 8px',gap:6,
                        color:'#fff',fontSize:11,fontWeight:600,fontFamily:'var(--font-jp)',
                        boxShadow:'0 1px 3px rgba(0,0,0,.18)',
                        opacity:t.done?.45:1,
                        textDecoration:t.done?'line-through':'none',
                        whiteSpace:'nowrap',overflow:'hidden'}}>
                        <div onMouseDown={e=>startResize(e,t,'left')} onTouchStart={e=>startResize(e,t,'left')}
                          style={{position:'absolute',left:0,top:0,bottom:0,width:bp==='mobile'?18:9,
                            cursor:'col-resize',touchAction:'none',zIndex:2}}/>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',flex:1}}>{t.text}</span>
                        {width > 120 && t.assignee && (
                          <span style={{opacity:.85,fontSize:10,fontWeight:500}}>{t.assignee}</span>
                        )}
                        <div onMouseDown={e=>startResize(e,t,'right')} onTouchStart={e=>startResize(e,t,'right')}
                          style={{position:'absolute',right:0,top:0,bottom:0,width:bp==='mobile'?18:9,
                            cursor:'col-resize',touchAction:'none',zIndex:2}}/>
                      </div>
                    )}
                    {/* Memo (below bar) */}
                    {hasMemo && visible && (
                      <div onClick={()=>onSelect(t)} style={{
                        position:'absolute',left,top:ROW_H-2,
                        width:Math.max(80, width),
                        maxWidth:`calc(100% - ${left}px)`,
                        height:MEMO_H,padding:'0 6px',
                        fontSize:bp==='mobile'?9.5:10,fontWeight:600,
                        color:cat.color,fontFamily:'var(--font-jp)',
                        background:`${cat.color}22`,
                        borderLeft:`2px solid ${cat.color}`,
                        borderRadius:'0 3px 3px 0',
                        display:'flex',alignItems:'center',
                        whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                        cursor:'pointer',opacity:t.done?.5:1,lineHeight:1,
                      }}>
                        <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{t.memo}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})

// ────────────────────────────────────────────────
// Calendar View — week rows with spanning task bars
// ────────────────────────────────────────────────
const CalendarView = memo(function CalendarView({ tasks, rangeStart, rangeDays, bp, onSelect, toggleDone, moveTask, onAddOn }) {
  const base = parseKey(rangeStart)
  const startOfWeek = addDays(base, -base.getDay())
  const weeks = Math.ceil((rangeDays + base.getDay()) / 7)
  const today = new Date(); today.setHours(0,0,0,0)
  const gridRef = useRef(null)
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)

  const DATE_H = bp === 'mobile' ? 24 : 26
  const TASK_H = bp === 'mobile' ? 20 : 22

  const startDrag = useCallback((e, task, cellDate) => {
    e.stopPropagation(); e.preventDefault()
    const grid = gridRef.current
    if(!grid) return
    const gridRect = grid.getBoundingClientRect()
    const cellW = gridRect.width / 7
    const rowH = (gridRect.height - 32) / weeks
    const startX = e.touches ? e.touches[0].clientX : e.clientX
    const startY = e.touches ? e.touches[0].clientY : e.clientY
    const sDate = parseKey(task.start_key)
    const eDate = parseKey(task.end_key)
    const sameStart = sameDay(cellDate, sDate)
    const sameEnd   = sameDay(cellDate, eDate)
    let mode
    if(sameStart && sameEnd)      mode = 'resize-end'
    else if(sameStart)            mode = 'resize-start'
    else if(sameEnd)              mode = 'resize-end'
    else                          mode = 'move'
    dragRef.current = { task, mode, cellW, rowH, startX, startY, deltaDays: 0, moved: false }
    const onMove = ev => {
      const d = dragRef.current; if(!d) return
      const x = ev.touches ? ev.touches[0].clientX : ev.clientX
      const y = ev.touches ? ev.touches[0].clientY : ev.clientY
      const dx = x - d.startX
      const dy = y - d.startY
      const useCoarse = ev.shiftKey
      const stepX = useCoarse ? d.cellW : d.cellW/2
      const xCells = Math.round(dx / stepX) * (useCoarse ? 1 : 0.5)
      const yRows = Math.round(dy / d.rowH)
      const newDelta = xCells + yRows*7
      if(Math.abs(newDelta) >= 0.5) d.moved = true
      if(newDelta !== d.deltaDays){
        d.deltaDays = newDelta
        setDrag({ id: d.task.id, deltaDays: newDelta, mode: d.mode })
      }
    }
    const onUp = () => {
      const d = dragRef.current
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
      if(d && d.moved && d.deltaDays !== 0){
        const t = d.task
        const deltaHalf = Math.round(d.deltaDays * 2)
        const origSH = startHalf(t, base)
        const origEH = endHalf(t, base)
        let sH = origSH, eH = origEH
        if(d.mode === 'move'){
          sH = origSH + deltaHalf; eH = origEH + deltaHalf
        } else if(d.mode === 'resize-start'){
          sH = Math.min(origSH + deltaHalf, origEH - 1)
        } else if(d.mode === 'resize-end'){
          eH = Math.max(origEH + deltaHalf, origSH + 1)
        }
        const {day:sDay, frac:sFrac} = halfToDayFrac(sH)
        const {day:eDay, frac:eFrac} = endHalfToDayFrac(eH)
        moveTask(t.id, toKey(addDays(base,sDay)), toKey(addDays(base,eDay)), sFrac, eFrac)
      }
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, {passive:false})
    window.addEventListener('touchend', onUp)
  }, [base, moveTask, weeks])

  const adjustedTasks = useMemo(()=>{
    if(!drag) return tasks
    const deltaHalf = Math.round(drag.deltaDays * 2)
    return tasks.map(t => {
      if(t.id !== drag.id) return t
      const origSH = startHalf(t, base)
      const origEH = endHalf(t, base)
      let sH = origSH, eH = origEH
      if(drag.mode === 'move'){
        sH = origSH + deltaHalf; eH = origEH + deltaHalf
      } else if(drag.mode === 'resize-start'){
        sH = Math.min(origSH + deltaHalf, origEH - 1)
      } else if(drag.mode === 'resize-end'){
        eH = Math.max(origEH + deltaHalf, origSH + 1)
      }
      const {day:sDay, frac:sFrac} = halfToDayFrac(sH)
      const {day:eDay, frac:eFrac} = endHalfToDayFrac(eH)
      return {...t, start_key:toKey(addDays(base,sDay)), end_key:toKey(addDays(base,eDay)), start_frac:sFrac, end_frac:eFrac}
    })
  }, [tasks, drag, base])

  return (
    <div data-weeks={weeks} style={{height:'100%',display:'flex',flexDirection:'column',
      background:'var(--bg)',padding:bp==='mobile'?6:10,overflow:'hidden'}}>
      <div ref={gridRef} style={{flex:1,display:'flex',flexDirection:'column',
        background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,
        overflow:'hidden',minHeight:0}}>

        {/* 曜日ヘッダー行 */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',flexShrink:0,
          borderBottom:'1px solid var(--border)'}}>
          {DAYS_JA.map((d,i)=>(
            <div key={i} style={{padding:'8px 4px',background:'var(--surface-2)',
              borderRight:i<6?'1px solid var(--border)':'none',
              textAlign:'center',fontSize:11.5,fontWeight:700,fontFamily:'var(--font-jp)',
              color:i===0?'var(--sun)':(i===6?'var(--sat)':'var(--text-2)')}}>{d}</div>
          ))}
        </div>

        {/* 週行 */}
        {Array.from({length:weeks}).map((_,wi)=>{
          const rowStart = addDays(startOfWeek, wi*7)
          const rowEnd   = addDays(startOfWeek, wi*7+6)

          const rowTasks = adjustedTasks.filter(t=>{
            const s=parseKey(t.start_key), e=parseKey(t.end_key)
            return e >= rowStart && s <= rowEnd
          })

          const laned = []
          const laneEnds = []
          for(const t of [...rowTasks].sort((a,b)=> a.start_key < b.start_key ? -1 : a.start_key > b.start_key ? 1 : 0)){
            const s=parseKey(t.start_key), e=parseKey(t.end_key)
            const colS = Math.max(0, diffDays(rowStart, s))
            const colE = Math.min(6, diffDays(rowStart, e))
            let lane = laneEnds.findIndex(lEnd => lEnd < colS)
            if(lane===-1){ lane=laneEnds.length; laneEnds.push(-1) }
            laneEnds[lane] = colE
            laned.push({...t, lane, colS, colE,
              isStart: s >= rowStart,
              isEnd:   e <= rowEnd,
            })
          }

          return (
            <div key={wi} style={{flex:1,position:'relative',minHeight:0,
              borderTop:wi>0?'1px solid var(--border)':'none'}}>

              {/* 日付セル層（背景・日付数字・クリックハンドラ） */}
              <div style={{position:'absolute',top:0,left:0,right:0,bottom:0,
                display:'grid',gridTemplateColumns:'repeat(7,1fr)'}}>
                {Array.from({length:7}).map((_,di)=>{
                  const date = addDays(rowStart, di)
                  const isT = sameDay(date, today)
                  const we = isWeekend(date)
                  const outOfRange = date < base || date >= addDays(base, rangeDays)
                  const nTasks = rowTasks.filter(t=>{
                    const s=parseKey(t.start_key),e=parseKey(t.end_key)
                    return date>=s && date<=e
                  }).length
                  return (
                    <div key={di}
                      onClick={e=>{
                        if(!dragRef.current?.moved && !outOfRange) onAddOn?.(toKey(date))
                      }}
                      style={{
                        borderRight:di<6?'1px solid var(--border)':'none',
                        background:isT?'var(--today)':(we?(di===0?'rgba(177,72,72,.04)':'rgba(47,93,160,.04)'):'var(--surface)'),
                        opacity:outOfRange?.45:1,
                        padding:bp==='mobile'?'4px 3px 0':'5px 5px 0',
                        cursor:outOfRange?'default':'pointer',
                      }}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',pointerEvents:'none'}}>
                        <div style={{display:'flex',alignItems:'baseline',gap:2}}>
                          {date.getDate()===1 && <span style={{fontSize:9,color:'var(--text-3)',fontFamily:'var(--font-jp)',fontWeight:600}}>{date.getMonth()+1}月</span>}
                          <span className="mono num" style={{fontSize:bp==='mobile'?13:15,fontWeight:700,
                            color:isT?'var(--accent-2)':(di===0?'var(--sun)':(di===6?'var(--sat)':'var(--text)'))}}>{date.getDate()}</span>
                        </div>
                        {nTasks>0 && <span className="mono num" style={{fontSize:9,color:'var(--text-4)',fontWeight:600}}>{nTasks}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* タスクバー層 — 週行全幅で絶対配置、セル境界を越えてテキスト表示 */}
              <div style={{position:'absolute',top:DATE_H,left:0,right:0,bottom:0,
                overflow:'hidden',pointerEvents:'none'}}>
                {laned.map(t=>{
                  const cat = catById(t.color)
                  const isDragging = drag && drag.id === t.id
                  const hasMemo = !!(t.memo && t.memo.trim())
                  const sFrac = t.start_frac>=0.5 ? 0.5 : 0
                  const eFrac = t.end_frac>=0.5 ? 0.5 : 0
                  const halfLeft  = t.isStart && sFrac>=0.5
                  const halfRight = t.isEnd   && eFrac>=0.5
                  const leftPct  = (t.colS + (halfLeft  ? 0.5 : 0)) / 7 * 100
                  const rightPct = (t.colE + 1 - (halfRight ? 0.5 : 0)) / 7 * 100
                  const topPx    = t.lane * TASK_H + 1
                  return (
                    <div key={t.id}
                      onMouseDown={e=>{
                        if(e.button!==0) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        const relX = (e.clientX - rect.left) / rect.width
                        const sDate=parseKey(t.start_key), eDate=parseKey(t.end_key)
                        let cellDate
                        if(sameDay(sDate,eDate))    cellDate = sDate
                        else if(relX < 0.15)        cellDate = sDate
                        else if(relX > 0.85)        cellDate = eDate
                        else                        cellDate = addDays(sDate, 1)
                        startDrag(e, t, cellDate)
                      }}
                      onTouchStart={e=>{
                        const touch = e.touches[0]
                        const rect = e.currentTarget.getBoundingClientRect()
                        const relX = (touch.clientX - rect.left) / rect.width
                        const sDate=parseKey(t.start_key), eDate=parseKey(t.end_key)
                        let cellDate
                        if(sameDay(sDate,eDate))    cellDate = sDate
                        else if(relX < 0.15)        cellDate = sDate
                        else if(relX > 0.85)        cellDate = eDate
                        else                        cellDate = addDays(sDate, 1)
                        startDrag(e, t, cellDate)
                      }}
                      onClick={e=>{ if(!dragRef.current?.moved) onSelect(t) }}
                      style={{
                        position:'absolute',
                        left:`calc(${leftPct}% + 1px)`,
                        width:`calc(${rightPct - leftPct}% - 2px)`,
                        top:topPx,
                        cursor:isDragging?'grabbing':'grab',
                        touchAction:'none',
                        opacity:isDragging?.7:1,
                        boxShadow:isDragging?'0 4px 12px rgba(0,0,0,.25)':'none',
                        pointerEvents:'auto',
                        display:'flex',flexDirection:'column',gap:1,
                        zIndex:isDragging?10:1,
                      }}>
                      <div style={{
                        background:cat.color,color:'#fff',
                        padding:`2px ${bp==='mobile'?4:6}px`,
                        borderTopLeftRadius:    t.isStart?3:0,
                        borderBottomLeftRadius: t.isStart?3:0,
                        borderTopRightRadius:   t.isEnd?3:0,
                        borderBottomRightRadius:t.isEnd?3:0,
                        fontSize:bp==='mobile'?10:11,fontWeight:600,fontFamily:'var(--font-jp)',
                        whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                        opacity:t.done?.5:1,lineHeight:1.4,
                        minHeight:bp==='mobile'?16:18,
                        textDecoration:t.done?'line-through':'none',
                      }}>{t.text}</div>
                      {hasMemo && (
                        <div style={{
                          padding:'1px 5px',
                          fontSize:bp==='mobile'?9:9.5,fontWeight:600,
                          color:cat.color,fontFamily:'var(--font-jp)',
                          background:`${cat.color}22`,
                          borderLeft:t.isStart?`2px solid ${cat.color}`:'none',
                          borderTopRightRadius:    t.isEnd?3:0,
                          borderBottomRightRadius: t.isEnd?3:0,
                          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                          minHeight:bp==='mobile'?13:14,
                          opacity:t.done?.5:1,lineHeight:1.35,
                        }}>{t.memo}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})


// ────────────────────────────────────────────────
// Agenda View (responsive: 2-col on tablet+, 1-col mobile)
// ────────────────────────────────────────────────
const AgendaView = memo(function AgendaView({ tasks, rangeStart, rangeDays, bp, onSelect, toggleDone }) {
  const base = parseKey(rangeStart)
  const today = new Date(); today.setHours(0,0,0,0)
  const todayKey = toKey(today)
  const dateList = Array.from({length:rangeDays},(_,i)=>addDays(base,i))

  const cols = bp==='mobile'? 1 : (bp==='tablet'? 2 : 3)

  return (
    <div style={{height:'100%',overflow:'auto',padding:bp==='mobile'?10:14,background:'var(--bg)'}}>
      <div style={{display:'grid',gridTemplateColumns:`repeat(${cols},1fr)`,gap:bp==='mobile'?10:14}}>
        {dateList.map((date)=>{
          const key = toKey(date)
          const dayTasks = tasks.filter(t=>{
            const s = parseKey(t.start_key), e = parseKey(t.end_key)
            return date >= s && date <= e
          })
          if(dayTasks.length===0) return null
          const isT = key===todayKey
          const dow = DAYS_JA[date.getDay()]
          const dayColor = date.getDay()===0?'var(--sun)':(date.getDay()===6?'var(--sat)':'var(--text)')
          return (
            <div key={key} style={{background:'var(--surface)',border:'1px solid var(--border)',
              borderRadius:10,overflow:'hidden',display:'flex',flexDirection:'column',
              boxShadow:isT?'0 0 0 2px var(--accent), var(--shadow-sm)':'var(--shadow-sm)'}}>
              {/* Day header */}
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',
                background:isT?'var(--today)':'var(--surface-2)',borderBottom:'1px solid var(--border)'}}>
                <div style={{
                  width:38,height:38,borderRadius:7,
                  background:isT?'var(--accent)':'var(--surface)',
                  color:isT?'#fff':dayColor,
                  border:isT?'none':'1px solid var(--border)',
                  display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                  flexShrink:0,
                }}>
                  <span style={{fontSize:9,fontWeight:700,opacity:.85,fontFamily:'var(--font-jp)',lineHeight:1}}>{dow}</span>
                  <span className="mono num" style={{fontSize:14,fontWeight:700,lineHeight:1.05}}>{date.getDate()}</span>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12.5,fontWeight:700,color:'var(--text)',fontFamily:'var(--font-jp)'}}>
                    {isT?'今日 · ':''}{date.getMonth()+1}月{date.getDate()}日({dow})
                  </div>
                  <div style={{fontSize:10.5,color:'var(--text-3)',fontFamily:'var(--font-jp)'}}>{dayTasks.length}件</div>
                </div>
              </div>

              {/* Tasks */}
              <div style={{display:'flex',flexDirection:'column'}}>
                {dayTasks.map((t,i)=>{
                  const cat = catById(t.color)
                  return (
                    <div key={t.id} onClick={()=>onSelect(t)}
                      style={{display:'flex',cursor:'pointer',
                        borderTop:i>0?'1px solid var(--border)':'none',
                        opacity:t.done?.55:1,transition:'background .1s ease'}}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <span style={{width:4,background:cat.color,flexShrink:0}}/>
                      <div style={{flex:1,padding:'8px 10px',minWidth:0}}>
                        <div style={{fontSize:12.5,fontWeight:600,color:'var(--text)',
                          fontFamily:'var(--font-jp)',textDecoration:t.done?'line-through':'none',
                          marginBottom:2,lineHeight:1.35,wordBreak:'break-word'}}>{t.text}</div>
                        <div style={{display:'flex',gap:6,fontSize:10.5,color:'var(--text-3)',
                          fontFamily:'var(--font-jp)',flexWrap:'wrap',alignItems:'center'}}>
                          <span style={{display:'inline-flex',alignItems:'center',gap:3}}>
                            <span style={{width:6,height:6,borderRadius:2,background:cat.color}}/>
                            {cat.label}
                          </span>
                          {t.assignee && <><span>·</span><span>{t.assignee}</span></>}
                          <span className="mono" style={{marginLeft:'auto',color:'var(--text-4)'}}>{fmtMD(parseKey(t.start_key))}–{fmtMD(parseKey(t.end_key))}</span>
                        </div>
                        {t.memo && (
                          <div style={{marginTop:5,padding:'5px 8px',background:'var(--surface-2)',
                            borderLeft:`2px solid ${cat.color}`,borderRadius:'0 4px 4px 0',
                            fontSize:11,color:'var(--text-2)',fontFamily:'var(--font-jp)',
                            whiteSpace:'pre-wrap',wordBreak:'break-word',lineHeight:1.45}}>{t.memo}</div>
                        )}
                      </div>
                      <button onClick={e=>{e.stopPropagation();toggleDone(t.id,!t.done)}}
                        style={{width:40,background:'transparent',border:'none',borderLeft:'1px solid var(--border)',
                          display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0}}>
                        <div style={{width:20,height:20,borderRadius:'50%',
                          border:`2px solid ${t.done?'#1F8A5B':'var(--text-4)'}`,
                          background:t.done?'#1F8A5B':'transparent',
                          color:'#fff',display:'flex',alignItems:'center',justifyContent:'center'}}>
                          {t.done && <Icon name="check" size={10}/>}
                        </div>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {tasks.length===0 && (
        <div style={{padding:'60px 20px',textAlign:'center',color:'var(--text-3)',fontFamily:'var(--font-jp)',gridColumn:'1/-1'}}>
          タスクがありません
        </div>
      )}
    </div>
  )
})

// ────────────────────────────────────────────────
// List View
// ────────────────────────────────────────────────
const ListView = memo(function ListView({ tasks, bp, onSelect, toggleDone, deleteTask }) {
  const sorted = useMemo(()=> [...tasks].sort((a,b)=> a.start_key.localeCompare(b.start_key)), [tasks])

  return (
    <div style={{height:'100%',overflow:'auto',padding:bp==='mobile'?10:16,background:'var(--bg)'}}>
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:8,overflow:'hidden'}}>
        {/* Header row */}
        {bp!=='mobile' && (
          <div style={{display:'grid',gridTemplateColumns:'40px 1.6fr 90px 100px 100px 1.2fr 60px',
            padding:'10px 14px',background:'var(--surface-2)',borderBottom:'1px solid var(--border)',
            fontSize:10,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',
            color:'var(--text-3)',fontFamily:'var(--font-jp)',gap:8,alignItems:'center'}}>
            <div></div>
            <div>タスク</div>
            <div>工種</div>
            <div>開始</div>
            <div>終了</div>
            <div>担当</div>
            <div style={{textAlign:'right'}}>操作</div>
          </div>
        )}
        {sorted.map(t=>{
          const cat = catById(t.color)
          if(bp==='mobile'){
            return (
              <div key={t.id} onClick={()=>onSelect(t)}
                style={{display:'flex',padding:'10px 12px',borderBottom:'1px solid var(--border)',
                  cursor:'pointer',gap:10,alignItems:'center',opacity:t.done?.55:1}}>
                <button onClick={e=>{e.stopPropagation();toggleDone(t.id,!t.done)}}
                  style={{width:22,height:22,borderRadius:'50%',
                    border:`2px solid ${t.done?'#1F8A5B':'var(--text-4)'}`,
                    background:t.done?'#1F8A5B':'transparent',cursor:'pointer',padding:0,
                    display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',flexShrink:0}}>
                  {t.done && <Icon name="check" size={11}/>}
                </button>
                <span style={{width:4,height:30,borderRadius:2,background:cat.color,flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,fontFamily:'var(--font-jp)',
                    textDecoration:t.done?'line-through':'none',
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.text}</div>
                  <div style={{fontSize:11,color:'var(--text-3)',fontFamily:'var(--font-jp)',display:'flex',gap:6,flexWrap:'wrap'}}>
                    <span>{cat.label}</span>
                    {t.assignee && <span>· {t.assignee}</span>}
                    <span className="mono">· {fmtMD(parseKey(t.start_key))}–{fmtMD(parseKey(t.end_key))}</span>
                  </div>
                </div>
              </div>
            )
          }
          return (
            <div key={t.id} onClick={()=>onSelect(t)}
              style={{display:'grid',gridTemplateColumns:'40px 1.6fr 90px 100px 100px 1.2fr 60px',
                padding:'10px 14px',borderBottom:'1px solid var(--border)',cursor:'pointer',gap:8,
                alignItems:'center',opacity:t.done?.55:1,
                transition:'background .1s ease'}}
              onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <button onClick={e=>{e.stopPropagation();toggleDone(t.id,!t.done)}}
                style={{width:22,height:22,borderRadius:'50%',
                  border:`2px solid ${t.done?'#1F8A5B':'var(--text-4)'}`,
                  background:t.done?'#1F8A5B':'transparent',cursor:'pointer',padding:0,
                  display:'flex',alignItems:'center',justifyContent:'center',color:'#fff'}}>
                {t.done && <Icon name="check" size={11}/>}
              </button>
              <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
                <span style={{width:4,height:18,borderRadius:2,background:cat.color,flexShrink:0}}/>
                <span style={{fontSize:13,fontWeight:500,fontFamily:'var(--font-jp)',
                  textDecoration:t.done?'line-through':'none',
                  overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.text}</span>
              </div>
              <span style={{fontSize:11.5,color:'var(--text-2)',fontFamily:'var(--font-jp)'}}>{cat.label}</span>
              <span className="mono num" style={{fontSize:12,color:'var(--text-2)'}}>{fmtMD(parseKey(t.start_key))}</span>
              <span className="mono num" style={{fontSize:12,color:'var(--text-2)'}}>{fmtMD(parseKey(t.end_key))}</span>
              <span style={{fontSize:12,fontFamily:'var(--font-jp)',color:'var(--text-2)',
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.assignee||'—'}</span>
              <div style={{display:'flex',justifyContent:'flex-end',gap:4}}>
                <button onClick={e=>{e.stopPropagation();deleteTask(t.id)}}
                  style={{width:26,height:26,padding:0,background:'transparent',border:'1px solid var(--border)',
                    borderRadius:5,cursor:'pointer',color:'var(--text-3)',
                    display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <Icon name="trash" size={13}/>
                </button>
              </div>
            </div>
          )
        })}
        {sorted.length===0 && (
          <div style={{padding:'40px 20px',textAlign:'center',color:'var(--text-3)',fontFamily:'var(--font-jp)'}}>
            タスクがありません
          </div>
        )}
      </div>
    </div>
  )
})

// ────────────────────────────────────────────────
// Task Detail Panel
// ────────────────────────────────────────────────
function TaskDetailPanel({ task, onClose, bp, onEdit, onToggleDone, onDelete }) {
  if(!task) return null
  const cat = catById(task.color)
  const start = parseKey(task.start_key), end = parseKey(task.end_key)
  const duration = diffDays(start,end)+1

  const containerStyle = bp==='mobile' ? {
    position:'fixed',inset:0,zIndex:90,background:'var(--surface)',
    display:'flex',flexDirection:'column',animation:'slideInR .2s ease',
  } : {
    position:'absolute',right:0,top:0,bottom:0,width:380,background:'var(--surface)',
    borderLeft:'1px solid var(--border)',boxShadow:'var(--shadow-lg)',zIndex:50,
    display:'flex',flexDirection:'column',animation:'slideInR .2s ease',
  }

  return (
    <div style={containerStyle}>
      <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)',
        display:'flex',alignItems:'flex-start',gap:12,flexShrink:0}}>
        <span style={{width:4,alignSelf:'stretch',borderRadius:2,background:cat.color,marginTop:4}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:10,fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',color:cat.color,marginBottom:4}}>
            {cat.en} · {cat.label}
          </div>
          <h3 style={{margin:0,fontSize:18,fontWeight:600,fontFamily:'var(--font-jp)',color:'var(--text)',
            textDecoration:task.done?'line-through':'none'}}>{task.text}</h3>
        </div>
        <button onClick={onClose} style={{background:'transparent',border:'none',cursor:'pointer',
          color:'var(--text-3)',padding:8,margin:-8,lineHeight:1}}>
          <Icon name="close" size={18}/>
        </button>
      </div>

      <div style={{flex:1,overflowY:'auto',padding:'16px 20px',display:'flex',flexDirection:'column',gap:18}}>
        <div style={{display:'grid',gridTemplateColumns:'80px 1fr',gap:'12px 16px',fontSize:12.5}}>
          <span style={{color:'var(--text-3)',fontFamily:'var(--font-jp)'}}>期間</span>
          <span className="mono" style={{color:'var(--text)'}}>
            {fmtMD(start)}({DAYS_JA[start.getDay()]}){(task.start_frac||0)>=0.5 && <span style={{color:'var(--accent-2)',fontFamily:'var(--font-jp)',marginLeft:3}}>午後</span>} → {fmtMD(end)}({DAYS_JA[end.getDay()]}){(task.end_frac||0)>=0.5 && <span style={{color:'var(--accent-2)',fontFamily:'var(--font-jp)',marginLeft:3}}>午前</span>}
            <span style={{marginLeft:8,color:'var(--text-3)'}}>
              {duration - ((task.start_frac||0)+(task.end_frac||0))}日間
            </span>
          </span>
          <span style={{color:'var(--text-3)',fontFamily:'var(--font-jp)'}}>担当</span>
          <span style={{fontFamily:'var(--font-jp)',color:'var(--text)'}}>{task.assignee || '—'}</span>
          <span style={{color:'var(--text-3)',fontFamily:'var(--font-jp)'}}>状態</span>
          <div>
            <span style={{display:'inline-flex',alignItems:'center',gap:6,padding:'3px 10px',
              borderRadius:20,background:task.done?'rgba(31,138,91,.12)':'rgba(228,161,26,.12)',
              color:task.done?'#1F8A5B':'var(--accent-2)',fontSize:11.5,fontWeight:600,fontFamily:'var(--font-jp)'}}>
              {task.done?'完了 (100%)':'未完了 (0%)'}
            </span>
          </div>
        </div>

        {task.memo && (
          <div>
            <div style={{fontSize:10,fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
              color:'var(--text-3)',marginBottom:8}}>メモ</div>
            <div style={{padding:'10px 12px',background:'var(--surface-2)',borderLeft:`3px solid ${cat.color}`,
              borderRadius:'0 6px 6px 0',fontSize:12.5,color:'var(--text-2)',
              fontFamily:'var(--font-jp)',whiteSpace:'pre-wrap',wordBreak:'break-word',lineHeight:1.6}}>
              {task.memo}
            </div>
          </div>
        )}
      </div>

      <div style={{display:'flex',gap:8,padding:16,borderTop:'1px solid var(--border)',flexShrink:0}}>
        <button onClick={()=>onToggleDone(task.id, !task.done)}
          style={{flex:1,height:40,background:task.done?'var(--surface-2)':'#1F8A5B',color:task.done?'var(--text-2)':'#fff',
            border:task.done?'1px solid var(--border)':'none',borderRadius:7,cursor:'pointer',
            fontSize:13,fontWeight:500,fontFamily:'var(--font-jp)'}}>
          {task.done?'未完了に戻す':'完了にする'}
        </button>
        <button onClick={()=>onEdit(task)}
          style={{flex:1,height:40,background:'var(--accent)',color:'#fff',border:'none',borderRadius:7,
            cursor:'pointer',fontSize:13,fontWeight:500,fontFamily:'var(--font-jp)'}}>編集</button>
        <button onClick={()=>{if(confirm('削除しますか？')) onDelete(task.id)}}
          style={{width:40,height:40,background:'var(--surface-2)',color:'#D42020',
            border:'1px solid var(--border)',borderRadius:7,cursor:'pointer',
            display:'flex',alignItems:'center',justifyContent:'center'}}>
          <Icon name="trash" size={15}/>
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────
// Task Edit Modal
// ────────────────────────────────────────────────
function TaskEditModal({ open, editTask, onClose, onSave, onDelete, assigneeHistory, removeFromHistory, bp }) {
  const [text, setText] = useState('')
  const [company, setCompany] = useState('')
  const [person, setPerson] = useState('')
  const [startKey, setStartKey] = useState('')
  const [endKey, setEndKey] = useState('')
  const [startPM, setStartPM] = useState(false)  // 開始: 午後から (start_frac=0.5)
  const [endAM, setEndAM] = useState(false)      // 終了: 午前まで (end_frac=0.5)
  const [color, setColor] = useState('green')
  const [memo, setMemo] = useState('')

  useEffect(()=>{
    if(open && editTask?.id){
      // Edit existing task
      setText(editTask.text||'')
      const sp = splitAssignee(editTask.assignee)
      setCompany(sp.company); setPerson(sp.person)
      setStartKey(editTask.start_key||'')
      setEndKey(editTask.end_key||'')
      setStartPM((editTask.start_frac||0) >= 0.5)
      setEndAM((editTask.end_frac||0) >= 0.5)
      setColor(editTask.color||'green')
      setMemo(editTask.memo||'')
    } else if(open){
      // New task — optionally pre-filled with date from calendar cell click
      setText(''); setCompany(''); setPerson('')
      const today = toKey(new Date())
      setStartKey(editTask?.start_key || today)
      setEndKey(editTask?.end_key || today)
      setStartPM(false); setEndAM(false)
      setColor('green'); setMemo('')
    }
  }, [open, editTask])

  if(!open) return null

  const handleSave = () => {
    if(!text.trim()){ alert('タスク名を入力してください'); return }
    if(!startKey || !endKey){ alert('日付を入力してください'); return }
    if(startKey > endKey){ alert('終了日は開始日以降にしてください'); return }
    if(startKey === endKey && startPM && endAM){
      alert('同日で「午後開始」かつ「午前終了」はできません'); return
    }
    onSave({
      id: editTask?.id || undefined,
      text: text.trim(),
      assignee: assigneeLabel(company, person),
      start_key: startKey, end_key: endKey,
      start_frac: startPM ? 0.5 : 0,
      end_frac:   endAM  ? 0.5 : 0,
      color, memo: memo.trim() || null,
    })
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(20,18,12,.5)',zIndex:200,
      display:'flex',alignItems:bp==='mobile'?'flex-end':'center',justifyContent:'center',
      animation:'fadeIn .15s ease',padding:bp==='mobile'?0:20}}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:'var(--surface)',
        borderRadius:bp==='mobile'?'20px 20px 0 0':12,
        padding:24,width:'100%',maxWidth:520,maxHeight:'92vh',overflowY:'auto',
        animation:'slideUp .2s ease',boxShadow:'var(--shadow-lg)',
      }}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <h3 style={{margin:0,fontSize:17,fontWeight:700,fontFamily:'var(--font-jp)',color:'var(--text)'}}>
            {editTask?.id?'タスク編集':'新規タスク'}
          </h3>
          {editTask?.id && (
            <button onClick={()=>{if(confirm('削除しますか？')) onDelete(editTask.id)}}
              style={{background:'rgba(212,32,32,.1)',border:'none',borderRadius:7,color:'#D42020',
                fontWeight:600,fontSize:12,padding:'6px 12px',cursor:'pointer',fontFamily:'var(--font-jp)'}}>
              削除
            </button>
          )}
        </div>

        <Label>タスク名</Label>
        <input value={text} onChange={e=>setText(e.target.value)} placeholder="例：基礎コンクリート打設"
          style={inputStyle}/>

        <Label>担当（会社・氏名）</Label>
        <div style={{display:'flex',gap:8,marginBottom:8}}>
          <input value={company} onChange={e=>setCompany(e.target.value)} placeholder="会社名"
            style={{...inputStyle,marginBottom:0,flex:1}}/>
          <input value={person} onChange={e=>setPerson(e.target.value)} placeholder="氏名"
            style={{...inputStyle,marginBottom:0,flex:1}}/>
        </div>


        {assigneeHistory.length>0 && (
          <>
            <div style={{fontSize:10,fontWeight:600,color:'var(--text-4)',marginBottom:6,letterSpacing:'.05em'}}>履歴</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:14}}>
              {assigneeHistory.slice(0,12).map(h=>(
                <div key={h} style={{display:'inline-flex',alignItems:'center',borderRadius:20,
                  border:'1px solid var(--border)',background:'var(--surface)',overflow:'hidden'}}>
                  <button onClick={()=>{const sp=splitAssignee(h);setCompany(sp.company);setPerson(sp.person)}}
                    style={{padding:'3px 8px 3px 10px',border:'none',background:'transparent',
                      color:'var(--text-2)',fontSize:11,fontWeight:500,fontFamily:'var(--font-jp)',cursor:'pointer'}}>
                    {h}
                  </button>
                  <button onClick={()=>removeFromHistory(h)}
                    style={{padding:'3px 8px 3px 2px',border:'none',background:'transparent',
                      color:'var(--text-4)',fontSize:13,lineHeight:1,cursor:'pointer'}}>×</button>
                </div>
              ))}
            </div>
          </>
        )}

        <Label>日付</Label>
        <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8,flexDirection:bp==='mobile'?'column':'row'}}>
          <input type="date" value={startKey} onChange={e=>setStartKey(e.target.value)}
            style={{...inputStyle,marginBottom:0,flex:1,width:bp==='mobile'?'100%':'auto'}}/>
          <span style={{color:'var(--text-4)',display:bp==='mobile'?'none':'inline'}}>→</span>
          <input type="date" value={endKey} onChange={e=>setEndKey(e.target.value)}
            style={{...inputStyle,marginBottom:0,flex:1,width:bp==='mobile'?'100%':'auto'}}/>
        </div>
        <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap'}}>
          <label style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer',
            padding:'6px 12px',borderRadius:7,border:`1.5px solid ${startPM?'var(--accent)':'var(--border)'}`,
            background:startPM?'rgba(228,161,26,.08)':'var(--surface-2)',
            fontSize:12,fontWeight:500,fontFamily:'var(--font-jp)',color:startPM?'var(--accent-2)':'var(--text-2)'}}>
            <input type="checkbox" checked={startPM} onChange={e=>setStartPM(e.target.checked)}
              style={{accentColor:'var(--accent)',cursor:'pointer'}}/>
            開始：午後から（半日）
          </label>
          <label style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer',
            padding:'6px 12px',borderRadius:7,border:`1.5px solid ${endAM?'var(--accent)':'var(--border)'}`,
            background:endAM?'rgba(228,161,26,.08)':'var(--surface-2)',
            fontSize:12,fontWeight:500,fontFamily:'var(--font-jp)',color:endAM?'var(--accent-2)':'var(--text-2)'}}>
            <input type="checkbox" checked={endAM} onChange={e=>setEndAM(e.target.checked)}
              style={{accentColor:'var(--accent)',cursor:'pointer'}}/>
            終了：午前まで（半日）
          </label>
        </div>

        <Label>工種</Label>
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:6}}>
          {CATEGORIES.map(c=>{
            // 「その他」の場合: color===c.id(gray) または HEXカラーが選択中ならアクティブ
            const isActive = c.id==='gray'
              ? (color==='gray' || (color?.startsWith?.('#')))
              : color===c.id
            const dispColor = isActive && c.id==='gray' && color?.startsWith?.('#') ? color : c.color
            return (
              <button key={c.id} onClick={()=>setColor(c.id==='gray' && color?.startsWith?.('#') ? color : c.id)}
                style={{padding:'7px 12px',borderRadius:7,
                  border:isActive?`2px solid ${dispColor}`:'1px solid var(--border)',
                  background:isActive?dispColor:'var(--surface)',
                  color:isActive?'#fff':'var(--text-2)',
                  fontSize:12,fontWeight:600,fontFamily:'var(--font-jp)',cursor:'pointer'}}>
                {c.label}
              </button>
            )
          })}
        </div>
        {/* 「その他」選択時のカラーピッカー */}
        {(color==='gray' || color?.startsWith?.('#')) && (
          <div style={{marginBottom:14,padding:'10px 12px',background:'var(--surface-2)',
            borderRadius:8,border:'1px solid var(--border)',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <span style={{fontSize:11,fontWeight:600,color:'var(--text-3)',fontFamily:'var(--font-jp)'}}>カスタムカラー</span>
            <input type="color"
              value={color?.startsWith?.('#') ? color : '#6B7280'}
              onChange={e=>setColor(e.target.value)}
              style={{width:36,height:28,borderRadius:5,border:'1px solid var(--border)',
                padding:2,cursor:'pointer',background:'var(--surface)'}}/>
            <span style={{fontSize:11,fontFamily:'var(--font-mono)',color:'var(--text-3)'}}>
              {color?.startsWith?.('#') ? color : '#6B7280'}
            </span>
            {/* プリセットカラー */}
            {['#E05252','#E07030','#B8960C','#3D8A4F','#3B6FB0','#7B5BA8','#2B8FA8','#1F7A6B','#6B7280'].map(hex=>(
              <button key={hex} onClick={()=>setColor(hex)}
                style={{width:20,height:20,borderRadius:'50%',background:hex,
                  border:color===hex?'2.5px solid var(--text)':'2px solid var(--surface)',
                  cursor:'pointer',flexShrink:0}}/>
            ))}
          </div>
        )}

        <Label>メモ</Label>
        <textarea value={memo} onChange={e=>setMemo(e.target.value)} placeholder="メモ（任意）"
          style={{...inputStyle,minHeight:70,resize:'vertical',lineHeight:1.5}}/>

        <div style={{display:'flex',gap:8,marginTop:10}}>
          <button onClick={onClose}
            style={{flex:1,height:46,background:'var(--surface-2)',color:'var(--text-2)',
              border:'1px solid var(--border)',borderRadius:10,cursor:'pointer',
              fontSize:14,fontWeight:600,fontFamily:'var(--font-jp)'}}>キャンセル</button>
          <button onClick={handleSave}
            style={{flex:2,height:46,background:'var(--accent)',color:'#fff',
              border:'none',borderRadius:10,cursor:'pointer',
              fontSize:14,fontWeight:700,fontFamily:'var(--font-jp)'}}>保存</button>
        </div>
      </div>
    </div>
  )
}

const inputStyle = {
  width:'100%',padding:'10px 12px',borderRadius:8,border:'1px solid var(--border)',
  background:'var(--surface-2)',color:'var(--text)',fontSize:13.5,outline:'none',
  marginBottom:14,fontFamily:'var(--font-jp)',
}
const Label = ({children}) => (
  <div style={{fontSize:10,fontWeight:600,color:'var(--text-3)',marginBottom:6,
    letterSpacing:'.05em',textTransform:'uppercase',fontFamily:'var(--font-jp)'}}>{children}</div>
)

// ────────────────────────────────────────────────
// Print Preview Bar
// ────────────────────────────────────────────────
function PrintPreviewBar({ onClose }) {
  return (
    <div className="preview-bar" style={{
      position:'fixed',top:12,left:'50%',transform:'translateX(-50%)',zIndex:95,
      display:'flex',alignItems:'center',gap:4,padding:4,background:'var(--text)',
      color:'var(--surface)',borderRadius:10,boxShadow:'0 12px 32px rgba(0,0,0,.25)',
      fontFamily:'var(--font-jp)',
    }}>
      <div style={{padding:'6px 12px',fontSize:12,fontWeight:500,display:'flex',alignItems:'center',gap:6}}>
        <Icon name="print" size={14}/>印刷プレビュー
      </div>
      <div style={{width:1,height:18,background:'rgba(255,255,255,.15)'}}/>
      <button onClick={()=>window.print()}
        style={{padding:'6px 14px',background:'var(--accent)',color:'#fff',border:'none',borderRadius:6,
          cursor:'pointer',fontSize:12,fontWeight:600,fontFamily:'var(--font-jp)',
          display:'inline-flex',alignItems:'center',gap:6}}>
        <Icon name="print" size={13}/>印刷する
      </button>
      <button onClick={onClose}
        style={{padding:'6px 10px',background:'transparent',color:'rgba(255,255,255,.7)',
          border:'none',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:500,
          fontFamily:'var(--font-jp)',display:'inline-flex',alignItems:'center',gap:4}}>
        <Icon name="close" size={13}/>閉じる
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────
// Print Header (visible only in print)
// ────────────────────────────────────────────────
function PrintHeader({ rangeStart, rangeDays, tasks, view }) {
  const start = parseKey(rangeStart)
  const end = addDays(start, rangeDays-1)
  const now = new Date()
  const pad = n => String(n).padStart(2,'0')
  const stamp = `${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const viewLabel = { gantt:'ガントチャート', calendar:'カレンダー', list:'タスクリスト' }[view] || '工程表'

  return (
    <div className="print-only" style={{
      marginBottom:8,paddingBottom:8,borderBottom:'2px solid #000',
      fontFamily:'var(--font-jp)',color:'#000',
    }}>
      <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
        <div style={{flex:1}}>
          <div style={{fontSize:9,fontWeight:600,letterSpacing:'.08em',color:'#666',textTransform:'uppercase'}}>
            Construction Schedule · {viewLabel}
          </div>
          <h1 style={{margin:'2px 0 4px',fontSize:16,fontWeight:700}}>工程表</h1>
          <div style={{fontSize:10,color:'#333',display:'flex',gap:12}}>
            <span><b>期間</b>: <span className="mono">{fmtMD(start)} – {fmtMD(end)}</span> ({rangeDays}日間)</span>
            <span><b>件数</b>: {tasks.length}</span>
          </div>
        </div>
        <div style={{textAlign:'right',fontSize:9,color:'#666'}}>
          <div className="mono">{stamp} 出力</div>
          <div style={{marginTop:2}}>{viewLabel}</div>
        </div>
      </div>
      <div style={{marginTop:6,display:'flex',flexWrap:'wrap',gap:'4px 12px',fontSize:9,color:'#333'}}>
        {CATEGORIES.map(c=>(
          <span key={c.id} style={{display:'inline-flex',alignItems:'center',gap:4}}>
            <span style={{width:8,height:8,background:c.color,borderRadius:2}}/>
            {c.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────
// ProjectCreateModal
// ────────────────────────────────────────────────
function ProjectCreateModal({ open, onClose, onSave }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(()=>{
    if(open){ setName(''); setCode('') }
  }, [open])

  if(!open) return null

  const handleSave = async () => {
    if(!name.trim()) return
    setSaving(true)
    await onSave({ name: name.trim(), code: code.trim() || null })
    setSaving(false)
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:900,
      display:'flex',alignItems:'center',justifyContent:'center'}}
      onClick={e=>{ if(e.target===e.currentTarget) onClose() }}>
      <div style={{background:'var(--surface)',borderRadius:12,padding:24,width:360,maxWidth:'90vw',
        boxShadow:'var(--shadow-lg)',animation:'slideUp .18s ease'}}>
        <div style={{fontSize:15,fontWeight:600,fontFamily:'var(--font-jp)',marginBottom:20}}>新規現場を追加</div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--text-3)',fontFamily:'var(--font-jp)',
            textTransform:'uppercase',letterSpacing:'.06em',marginBottom:5}}>現場名 <span style={{color:'#D42020'}}>*</span></div>
          <input
            autoFocus value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') handleSave() }}
            placeholder="例：○○マンション新築工事"
            style={{width:'100%',height:36,padding:'0 10px',background:'var(--surface-2)',
              border:'1px solid var(--border)',borderRadius:7,fontSize:13,color:'var(--text)',
              fontFamily:'var(--font-jp)',outline:'none'}}
            onFocus={e=>e.currentTarget.style.borderColor='var(--accent)'}
            onBlur={e=>e.currentTarget.style.borderColor='var(--border)'}/>
        </div>

        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--text-3)',fontFamily:'var(--font-jp)',
            textTransform:'uppercase',letterSpacing:'.06em',marginBottom:5}}>現場コード（任意）</div>
          <input
            value={code} onChange={e=>setCode(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') handleSave() }}
            placeholder="例：2024-A01"
            style={{width:'100%',height:36,padding:'0 10px',background:'var(--surface-2)',
              border:'1px solid var(--border)',borderRadius:7,fontSize:13,color:'var(--text)',
              fontFamily:'var(--font-mono)',outline:'none'}}
            onFocus={e=>e.currentTarget.style.borderColor='var(--accent)'}
            onBlur={e=>e.currentTarget.style.borderColor='var(--border)'}/>
        </div>

        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onClose}
            style={{height:34,padding:'0 16px',background:'var(--surface-2)',
              border:'1px solid var(--border)',borderRadius:7,cursor:'pointer',
              fontSize:13,fontFamily:'var(--font-jp)',color:'var(--text-2)'}}>
            キャンセル
          </button>
          <button onClick={handleSave} disabled={!name.trim()||saving}
            style={{height:34,padding:'0 18px',background:'var(--accent)',
              border:'1px solid var(--accent-2)',borderRadius:7,cursor:'pointer',
              fontSize:13,fontFamily:'var(--font-jp)',color:'#fff',fontWeight:600,
              opacity: (!name.trim()||saving)?0.5:1}}>
            {saving ? '保存中…' : '追加'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────
// ProjectCard
// ────────────────────────────────────────────────
function ProjectCard({ project, onEnter, onDelete }) {
  const [showMenu, setShowMenu] = useState(false)
  const pct = Math.round((project.doneCount||0)/Math.max(1,project.taskCount||0)*100)
  const menuRef = useRef(null)

  useEffect(()=>{
    if(!showMenu) return
    const h = e => { if(menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false) }
    document.addEventListener('mousedown', h)
    return ()=> document.removeEventListener('mousedown', h)
  }, [showMenu])

  return (
    <div
      onClick={onEnter}
      style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,
        padding:'16px 18px',cursor:'pointer',position:'relative',
        transition:'box-shadow .15s ease, border-color .15s ease',
        boxShadow:'var(--shadow-sm)'}}
      onMouseEnter={e=>{ e.currentTarget.style.boxShadow='var(--shadow)'; e.currentTarget.style.borderColor='var(--border-2)' }}
      onMouseLeave={e=>{ e.currentTarget.style.boxShadow='var(--shadow-sm)'; e.currentTarget.style.borderColor='var(--border)' }}>

      {/* Header row */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:10}}>
        <div style={{minWidth:0,flex:1,paddingRight:8}}>
          <div style={{fontSize:14,fontWeight:600,fontFamily:'var(--font-jp)',color:'var(--text)',
            whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginBottom:2}}>
            {project.name}
          </div>
          {project.code && (
            <div style={{fontSize:11,color:'var(--text-3)',fontFamily:'var(--font-mono)',letterSpacing:'.04em'}}>
              {project.code}
            </div>
          )}
        </div>
        {/* 3-dot menu */}
        <div ref={menuRef} style={{position:'relative',flexShrink:0}} onClick={e=>e.stopPropagation()}>
          <button onClick={e=>{ e.stopPropagation(); setShowMenu(s=>!s) }}
            style={{width:26,height:26,display:'flex',alignItems:'center',justifyContent:'center',
              background:'transparent',border:'none',borderRadius:5,cursor:'pointer',
              color:'var(--text-3)',fontSize:16,lineHeight:1}}>⋯</button>
          {showMenu && (
            <div style={{position:'absolute',right:0,top:30,background:'var(--surface)',
              border:'1px solid var(--border)',borderRadius:8,boxShadow:'var(--shadow-lg)',
              overflow:'hidden',minWidth:110,zIndex:100}}>
              <button onClick={()=>{ setShowMenu(false); onEnter() }}
                style={{display:'block',width:'100%',padding:'8px 14px',textAlign:'left',
                  background:'transparent',border:'none',cursor:'pointer',
                  fontSize:12,fontFamily:'var(--font-jp)',color:'var(--text)'}}>
                開く
              </button>
              <button onClick={()=>{ setShowMenu(false); onDelete(project.id) }}
                style={{display:'block',width:'100%',padding:'8px 14px',textAlign:'left',
                  background:'transparent',border:'none',cursor:'pointer',
                  fontSize:12,fontFamily:'var(--font-jp)',color:'#D42020'}}>
                削除
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{height:4,borderRadius:2,background:'var(--surface-3)',overflow:'hidden',marginBottom:8}}>
        <div style={{height:'100%',width:`${pct}%`,background:'#1F8A5B',
          transition:'width .3s ease',borderRadius:2}}/>
      </div>

      {/* Stats row */}
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <span className="mono num" style={{fontSize:18,fontWeight:600,color:'var(--text)',lineHeight:1}}>{pct}</span>
        <span style={{fontSize:11,color:'var(--text-3)'}}>%</span>
        <span style={{fontSize:11,color:'var(--text-3)',fontFamily:'var(--font-jp)',marginLeft:4}}>
          {project.doneCount||0}/{project.taskCount||0} タスク完了
        </span>
        <span style={{marginLeft:'auto',fontSize:10.5,color:'var(--text-4)',fontFamily:'var(--font-jp)'}}>
          {new Date(project.created_at).toLocaleDateString('ja-JP',{month:'short',day:'numeric'})}
        </span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────
// ProjectsScreen
// ────────────────────────────────────────────────
function ProjectsScreen({ bp, projects, loading, onCreate, onEnter, onDelete }) {
  return (
    <div style={{height:'100%',overflow:'auto',background:'var(--bg)'}}>
      <div style={{maxWidth:900,margin:'0 auto',padding: bp==='mobile'?'24px 16px':'40px 32px'}}>
        {/* Page header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:28}}>
          <div>
            <h1 style={{fontSize:bp==='mobile'?18:22,fontWeight:700,fontFamily:'var(--font-jp)',
              color:'var(--text)',marginBottom:4}}>現場一覧</h1>
            <p style={{fontSize:12,color:'var(--text-3)',fontFamily:'var(--font-jp)'}}>
              現場を選んで工程表を管理する
            </p>
          </div>
          <button onClick={onCreate}
            style={{display:'inline-flex',alignItems:'center',gap:6,height:36,padding:'0 16px',
              background:'var(--accent)',border:'1px solid var(--accent-2)',borderRadius:8,
              cursor:'pointer',fontSize:13,fontFamily:'var(--font-jp)',color:'#fff',fontWeight:600,
              boxShadow:'var(--shadow-sm)'}}>
            <Icon name="plus" size={14}/>
            {bp!=='mobile' && '新規現場を追加'}
          </button>
        </div>

        {loading ? (
          <div style={{padding:60,textAlign:'center',color:'var(--text-3)',fontFamily:'var(--font-jp)'}}>読み込み中…</div>
        ) : projects.length === 0 ? (
          <div style={{textAlign:'center',padding:'80px 20px'}}>
            <div style={{fontSize:40,marginBottom:16}}>🏗</div>
            <div style={{fontSize:15,fontWeight:600,fontFamily:'var(--font-jp)',color:'var(--text)',marginBottom:8}}>
              まだ現場がありません
            </div>
            <div style={{fontSize:13,color:'var(--text-3)',fontFamily:'var(--font-jp)',marginBottom:24}}>
              「新規現場を追加」から現場を作成してください
            </div>
            <button onClick={onCreate}
              style={{display:'inline-flex',alignItems:'center',gap:6,height:38,padding:'0 20px',
                background:'var(--accent)',border:'1px solid var(--accent-2)',borderRadius:8,
                cursor:'pointer',fontSize:13,fontFamily:'var(--font-jp)',color:'#fff',fontWeight:600}}>
              <Icon name="plus" size={14}/>
              新規現場を追加
            </button>
          </div>
        ) : (
          <div style={{
            display:'grid',
            gridTemplateColumns: bp==='mobile'?'1fr': bp==='tablet'?'repeat(2,1fr)':'repeat(3,1fr)',
            gap: bp==='mobile'?12:16
          }}>
            {projects.map(p=>(
              <ProjectCard
                key={p.id}
                project={p}
                onEnter={()=>onEnter(p.id)}
                onDelete={onDelete}/>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────
// App root
// ────────────────────────────────────────────────
export default function App() {
  const bp = useBreakpoint()
  const [theme, setTheme] = useState(()=> localStorage.getItem('kh-theme') || 'light')
  const [view, setView] = useState('calendar')
  const [rangeStart, setRangeStart] = useState(()=> toKey(addDays(new Date(), -3)))
  const [rangeDays, setRangeDays] = useState(()=> bp==='mobile' ? 14 : 28)
  const [activeCats, setActiveCats] = useState([])
  const [search, setSearch] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTask, setEditTask] = useState(null)
  const [printPreview, setPrintPreview] = useState(false)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [assigneeHistory, setAssigneeHistory] = useState(()=>{
    try { return JSON.parse(localStorage.getItem('kh-assignee-history')||'[]') } catch { return [] }
  })
  const [toastMsg, showToast] = useToast()

  // Projects state
  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [currentProjectId, setCurrentProjectId] = useState(null)
  const [projectModalOpen, setProjectModalOpen] = useState(false)

  // Theme persistence
  useEffect(()=>{
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('kh-theme', theme)
  }, [theme])

  // Print preview body class
  useEffect(()=>{
    if(printPreview) document.body.classList.add('kh-print-preview')
    else document.body.classList.remove('kh-print-preview')
  }, [printPreview])

  // Esc to close print preview
  useEffect(()=>{
    if(!printPreview) return
    const k = e => { if(e.key==='Escape') setPrintPreview(false) }
    window.addEventListener('keydown', k)
    return ()=> window.removeEventListener('keydown', k)
  }, [printPreview])

  // Close drawer on desktop
  useEffect(()=>{ if(bp==='desktop') setDrawerOpen(false) }, [bp])

  // Load projects (with task counts)
  const loadProjects = useCallback(async ()=>{
    setProjectsLoading(true)
    try {
      const { data: projs, error } = await supabase.from('projects').select('*').order('created_at', { ascending:false })
      if(error) throw error
      // Load task counts
      const { data: counts } = await supabase.from('tasks').select('project_id, done')
      const cMap={}, dMap={}
      ;(counts||[]).forEach(t=>{
        if(!t.project_id) return
        cMap[t.project_id]=(cMap[t.project_id]||0)+1
        if(t.done) dMap[t.project_id]=(dMap[t.project_id]||0)+1
      })
      setProjects((projs||[]).map(p=>({...p, taskCount:cMap[p.id]||0, doneCount:dMap[p.id]||0})))
    } catch(e){
      console.error(e); showToast('現場データの取得に失敗しました')
    } finally { setProjectsLoading(false) }
  }, [showToast])

  useEffect(()=>{ loadProjects() }, [loadProjects])

  // Save project (insert)
  const saveProject = useCallback(async (payload)=>{
    try {
      const { error } = await supabase.from('projects').insert({
        name: payload.name, code: payload.code || null
      })
      if(error) throw error
      setProjectModalOpen(false)
      await loadProjects()
    } catch(e){
      console.error(e); showToast('現場の保存に失敗しました: '+(e.message||''))
    }
  }, [loadProjects, showToast])

  // Delete project
  const deleteProject = useCallback(async (id)=>{
    if(!window.confirm('この現場とすべての工程データを削除しますか？\nこの操作は元に戻せません。')) return
    try {
      const { error } = await supabase.from('projects').delete().eq('id', id)
      if(error) throw error
      await loadProjects()
    } catch(e){
      console.error(e); showToast('削除に失敗しました')
    }
  }, [loadProjects, showToast])

  // Load tasks (scoped to current project)
  const loadTasks = useCallback(async ()=>{
    if(!currentProjectId) return
    setLoading(true)
    try {
      const { data, error } = await supabase.from('tasks').select('*')
        .eq('project_id', currentProjectId).order('start_key')
      if(error){ console.error(error); showToast('データの取得に失敗しました'); return }
      setTasks((data||[]).map(t=>({...t, done: t.done||false})))
    } catch(e){
      console.error(e); showToast('データの取得に失敗しました')
    } finally { setLoading(false) }
  }, [showToast, currentProjectId])

  useEffect(()=>{ loadTasks() }, [loadTasks])

  // Realtime subscription (scoped to current project)
  useEffect(()=>{
    if(!currentProjectId) return
    const ch = supabase.channel(`tasks-changes-${currentProjectId}`)
      .on('postgres_changes', { event:'*', schema:'public', table:'tasks',
        filter:`project_id=eq.${currentProjectId}` }, ()=> loadTasks())
      .subscribe()
    return ()=> supabase.removeChannel(ch)
  }, [loadTasks, currentProjectId])

  // Toggle done (optimistic)
  const toggleDone = useCallback(async (id, newDone)=>{
    const prev = tasks.find(t=>t.id===id)?.done
    setTasks(p => p.map(t=> t.id===id?{...t, done:newDone}:t))
    setSelectedTask(p => p && p.id===id ? {...p, done:newDone} : p)
    try {
      const { error } = await supabase.from('tasks').update({done:newDone}).eq('id', id)
      if(error) throw error
    } catch(e){
      showToast('更新に失敗しました')
      setTasks(p => p.map(t=> t.id===id?{...t, done:prev}:t))
    }
  }, [tasks, showToast])

  // Resize task (supports half-day fracs)
  const resizeTask = useCallback(async (id, sk, ek, sFrac=0, eFrac=0)=>{
    const prev = tasks.find(t=>t.id===id)
    setTasks(p => p.map(t=> t.id===id?{...t, start_key:sk, end_key:ek, start_frac:sFrac, end_frac:eFrac}:t))
    try {
      const { error } = await supabase.from('tasks').update({
        start_key:sk, end_key:ek, start_frac:sFrac, end_frac:eFrac
      }).eq('id', id)
      if(error) throw error
    } catch(e){
      console.error(e)
      showToast('更新に失敗しました')
      if(prev) setTasks(p => p.map(t=> t.id===id?prev:t))
    }
  }, [tasks, showToast])

  // Move task (whole shift, used by calendar drag)
  const moveTask = useCallback(async (id, sk, ek, sFrac=0, eFrac=0)=>{
    const prev = tasks.find(t=>t.id===id)
    setTasks(p => p.map(t=> t.id===id?{...t, start_key:sk, end_key:ek, start_frac:sFrac, end_frac:eFrac}:t))
    try {
      const { error } = await supabase.from('tasks').update({
        start_key:sk, end_key:ek, start_frac:sFrac, end_frac:eFrac
      }).eq('id', id)
      if(error) throw error
    } catch(e){
      console.error(e)
      showToast('更新に失敗しました')
      if(prev) setTasks(p => p.map(t=> t.id===id?prev:t))
    }
  }, [tasks, showToast])

  // Save (insert or update)
  const saveTask = useCallback(async (payload)=>{
    try {
      if(payload.id){
        const { error } = await supabase.from('tasks').update({
          text:payload.text, assignee:payload.assignee,
          start_key:payload.start_key, end_key:payload.end_key,
          start_frac:payload.start_frac||0, end_frac:payload.end_frac||0,
          color:payload.color, memo:payload.memo,
        }).eq('id', payload.id)
        if(error) throw error
      } else {
        const { error } = await supabase.from('tasks').insert({
          text:payload.text, assignee:payload.assignee,
          start_key:payload.start_key, end_key:payload.end_key,
          start_frac:payload.start_frac||0, end_frac:payload.end_frac||0,
          color:payload.color, memo:payload.memo, done:false,
          project_id: currentProjectId,
        })
        if(error) throw error
      }
      // Update assignee history
      if(payload.assignee){
        const nh = [payload.assignee, ...assigneeHistory.filter(h=>h!==payload.assignee)].slice(0,30)
        setAssigneeHistory(nh)
        localStorage.setItem('kh-assignee-history', JSON.stringify(nh))
      }
      setModalOpen(false); setEditTask(null)
      await loadTasks()
    } catch(e){
      console.error(e); showToast('保存に失敗しました: '+(e.message||''))
    }
  }, [assigneeHistory, loadTasks, showToast, currentProjectId])

  // Delete
  const deleteTask = useCallback(async (id)=>{
    setTasks(p => p.filter(t=>t.id!==id))
    setSelectedTask(p => p && p.id===id ? null : p)
    setModalOpen(false); setEditTask(null)
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if(error) throw error
    } catch(e){
      showToast('削除に失敗しました')
      await loadTasks()
    }
  }, [loadTasks, showToast])

  const removeFromHistory = useCallback((name)=>{
    const nh = assigneeHistory.filter(h=>h!==name)
    setAssigneeHistory(nh)
    localStorage.setItem('kh-assignee-history', JSON.stringify(nh))
  }, [assigneeHistory])

  // Filter tasks
  const filteredTasks = useMemo(()=>{
    const q = search.trim().toLowerCase()
    return tasks.filter(t=>{
      if(activeCats.length>0 && !activeCats.includes(effectiveCatId(t.color))) return false
      if(q){
        const hay = `${t.text||''} ${t.assignee||''} ${t.memo||''} ${catById(t.color).label}`.toLowerCase()
        if(!hay.includes(q)) return false
      }
      return true
    })
  }, [tasks, activeCats, search])

  // View options
  const viewOptions = [
    { id:'calendar', icon:'calendar', label:'カレンダー' },
    { id:'gantt',    icon:'gantt',    label:'ガント' },
    { id:'list',     icon:'list',     label:'リスト' },
  ]

  // Enter / leave project
  const enterProject = useCallback((id)=>{
    setCurrentProjectId(id)
    setTasks([])
    setSelectedTask(null)
  }, [])

  const backToProjects = useCallback(()=>{
    setCurrentProjectId(null)
    setTasks([])
    setSelectedTask(null)
    setDrawerOpen(false)
    loadProjects()
  }, [loadProjects])

  // Current project object
  const currentProject = useMemo(()=> projects.find(p=>p.id===currentProjectId)||null, [projects, currentProjectId])

  // Layout grid
  const gridStyle = bp==='desktop' ? {
    gridTemplateColumns:'228px 1fr',
    gridTemplateRows:'52px 44px 1fr',
    gridTemplateAreas:`"header header" "sidebar subheader" "sidebar main"`,
  } : bp==='tablet' ? {
    gridTemplateColumns:'1fr',
    gridTemplateRows:'52px 44px 1fr',
    gridTemplateAreas:`"header" "subheader" "main"`,
  } : {
    gridTemplateColumns:'1fr',
    gridTemplateRows:'52px 44px 1fr 56px',
    gridTemplateAreas:`"header" "subheader" "main" "tabbar"`,
  }

  // ── Projects screen (no project selected) ──
  if(currentProjectId === null) {
    return (
      <>
        <style>{CSS}</style>
        <div style={{display:'grid',gridTemplateRows:'52px 1fr',height:'100%',width:'100%',
          background:'var(--bg)',overflow:'hidden'}}>
          {/* Minimal header for projects screen */}
          <header style={{display:'flex',alignItems:'center',
            padding:bp==='mobile'?'0 12px':'0 20px',
            background:'var(--surface)',borderBottom:'1px solid var(--border)',
            gap:14,height:52,flexShrink:0}}>
            <div style={{width:28,height:28,borderRadius:6,background:'var(--text)',color:'var(--surface)',
              display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:13,
              fontFamily:'var(--font-jp)',flexShrink:0}}>工</div>
            <span style={{fontSize:14,fontWeight:600,fontFamily:'var(--font-jp)',color:'var(--text)',flex:1}}>工程表</span>
            <IconButton icon={theme==='dark'?'sun':'moon'}
              onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}
              title={theme==='dark'?'ライトモード':'ダークモード'}/>
          </header>

          <ProjectsScreen
            bp={bp}
            projects={projects}
            loading={projectsLoading}
            onCreate={()=>setProjectModalOpen(true)}
            onEnter={enterProject}
            onDelete={deleteProject}/>
        </div>

        <ProjectCreateModal
          open={projectModalOpen}
          onClose={()=>setProjectModalOpen(false)}
          onSave={saveProject}/>

        {toastMsg && <div className="kh-toast">{toastMsg}</div>}
      </>
    )
  }

  // ── Task screen (project selected) ──
  return (
    <>
      <style>{CSS}</style>
      <div style={{display:'grid',...gridStyle,height:'100%',width:'100%',background:'var(--bg)',overflow:'hidden'}}>
        <PrintHeader rangeStart={rangeStart} rangeDays={rangeDays} tasks={filteredTasks} view={view}/>

        <Header
          bp={bp} view={view} setView={setView}
          search={search} setSearch={setSearch}
          onOpenDrawer={()=>setDrawerOpen(true)}
          onAdd={()=>{ setEditTask(null); setModalOpen(true) }}
          onPrint={()=>setPrintPreview(true)}
          onToggleTheme={()=>setTheme(t=>t==='dark'?'light':'dark')}
          theme={theme}
          viewOptions={viewOptions}
          searchExpanded={searchExpanded} setSearchExpanded={setSearchExpanded}
          currentProject={currentProject}
          onBack={backToProjects}
        />

        {bp==='desktop' && (
          <Sidebar activeCats={activeCats} setActiveCats={setActiveCats} tasks={tasks}/>
        )}
        <SidebarDrawer open={drawerOpen} onClose={()=>setDrawerOpen(false)}
          activeCats={activeCats} setActiveCats={setActiveCats} tasks={tasks}/>

        <SubHeader rangeStart={rangeStart} setRangeStart={setRangeStart}
          rangeDays={rangeDays} setRangeDays={setRangeDays} bp={bp}/>

        <main style={{gridArea:'main',overflow:'hidden',position:'relative',background:'var(--bg)'}}>
          {loading ? (
            <div style={{padding:60,textAlign:'center',color:'var(--text-3)',fontFamily:'var(--font-jp)'}}>読み込み中…</div>
          ) : (
            <>
              {view==='gantt'    && <GanttView    tasks={filteredTasks} rangeStart={rangeStart} rangeDays={rangeDays} bp={bp} onSelect={setSelectedTask} resizeTask={resizeTask} toggleDone={toggleDone}/>}
              {view==='calendar' && <CalendarView tasks={filteredTasks} rangeStart={rangeStart} rangeDays={rangeDays} bp={bp} onSelect={setSelectedTask} toggleDone={toggleDone} moveTask={moveTask} onAddOn={(dateKey)=>{ setEditTask({ start_key:dateKey, end_key:dateKey }); setModalOpen(true) }}/>}
              {view==='list'     && <ListView     tasks={filteredTasks} bp={bp} onSelect={setSelectedTask} toggleDone={toggleDone} deleteTask={deleteTask}/>}
            </>
          )}
        </main>

        {bp==='mobile' && <BottomTabBar view={view} setView={setView} options={viewOptions}/>}

        {selectedTask && (
          <TaskDetailPanel task={selectedTask} bp={bp}
            onClose={()=>setSelectedTask(null)}
            onEdit={t=>{setEditTask(t); setModalOpen(true); setSelectedTask(null)}}
            onToggleDone={toggleDone} onDelete={deleteTask}/>
        )}

        <TaskEditModal open={modalOpen} editTask={editTask}
          onClose={()=>{setModalOpen(false); setEditTask(null)}}
          onSave={saveTask} onDelete={deleteTask}
          assigneeHistory={assigneeHistory} removeFromHistory={removeFromHistory} bp={bp}/>

        {printPreview && <PrintPreviewBar onClose={()=>setPrintPreview(false)}/>}

        {toastMsg && <div className="kh-toast">{toastMsg}</div>}
      </div>
    </>
  )
}
