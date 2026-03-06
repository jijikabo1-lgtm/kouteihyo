import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

const DAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

const TASK_COLORS = [
  { id: "orange", label: "構造", bg: "#E8521A", text: "#fff" },
  { id: "blue",   label: "設備", bg: "#1A6FE8", text: "#fff" },
  { id: "green",  label: "内装", bg: "#1A9E5C", text: "#fff" },
  { id: "red",    label: "検査", bg: "#D42020", text: "#fff" },
  { id: "yellow", label: "定例", bg: "#C49800", text: "#fff" },
  { id: "purple", label: "搬入", bg: "#7C3AED", text: "#fff" },
  { id: "gray",   label: "その他", bg: "#52606D", text: "#fff" },
];

function toKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function diffDays(a, b) { return Math.round((b-a)/(1000*60*60*24)); }
function parseKey(k) { const [y,m,d]=k.split("-"); return new Date(+y,+m-1,+d); }

function layoutTasks(tasks, totalCols, startDate) {
  const placed = tasks.map(t => {
    const s = diffDays(startDate, parseKey(t.start_key));
    const e = diffDays(startDate, parseKey(t.end_key));
    return { ...t, col: s, endCol: e };
  }).filter(t => t.endCol >= 0 && t.col < totalCols);

  const lanes = [];
  const result = [];
  for (const t of [...placed].sort((a,b)=>a.col-b.col)) {
    let lane = lanes.findIndex(l => (l[l.length-1]||{}).endCol < t.col);
    if (lane === -1) { lane = lanes.length; lanes.push([]); }
    lanes[lane].push({ endCol: t.endCol });
    result.push({ ...t, lane });
  }
  return result;
}

export default function App() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay()); // 今週の日曜日
    return d;
  });
  const [viewDays, setViewDays] = useState(14);
  const [tasks, setTasks] = useState([]);
  const [modal, setModal] = useState(null);
  const [status, setStatus] = useState("loading");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);

  // 初回読み込み
  useEffect(() => {
    const load = async () => {
      setStatus("loading");
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) { setStatus("error"); return; }
      setTasks(data || []);
      setStatus("synced");
    };
    load();
  }, []);

  // リアルタイム購読
  useEffect(() => {
    const channel = supabase
      .channel("tasks-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tasks" }, payload => {
        setTasks(prev => [...prev, payload.new]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks" }, payload => {
        setTasks(prev => prev.map(t => t.id === payload.new.id ? payload.new : t));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, payload => {
        setTasks(prev => prev.filter(t => t.id !== payload.old.id));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const colDates = Array.from({length: viewDays}, (_,i) => addDays(startDate, i));
  const laidOut = layoutTasks(tasks, viewDays, startDate);
  const maxLane = laidOut.reduce((m,t)=>Math.max(m,t.lane), -1);
  const LANE_H = 26;
  const GRID_H = Math.max((maxLane+1) * LANE_H + 8, 72);
  const weeks = [];
  for (let i = 0; i < viewDays; i += 7) weeks.push(colDates.slice(i, i+7));

  const openAdd = (dateKey) => {
    setModal({ start_key: dateKey, end_key: dateKey, text: "", color: "orange", editId: null });
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const saveTask = async () => {
    if (!modal.text.trim()) return;
    const payload = {
      start_key: modal.start_key,
      end_key: modal.end_key,
      text: modal.text.trim(),
      color: modal.color,
    };
    setStatus("saving");
    if (modal.editId) {
      await supabase.from("tasks").update(payload).eq("id", modal.editId);
    } else {
      await supabase.from("tasks").insert(payload);
    }
    setStatus("synced");
    setModal(null);
  };

  const deleteTask = async (id) => {
    setStatus("saving");
    await supabase.from("tasks").delete().eq("id", id);
    setStatus("synced");
    setModal(null);
  };

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const todayKey = toKey(new Date());
  const statusColor = { loading:"#F5C200", synced:"#22A86E", saving:"#1A6FE8", error:"#D42020" }[status];
  const statusLabel = { loading:"読み込み中…", synced:"同期済み ✓", saving:"保存中…", error:"エラー" }[status];

  return (
    <div style={{ minHeight:"100vh", background:"#EDEAE3", fontFamily:"'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif" }}>

      {/* Header */}
      <div style={{
        background:"#192536", padding:"10px 14px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        position:"sticky", top:0, zIndex:300, boxShadow:"0 2px 12px rgba(0,0,0,0.4)",
      }}>
        <div>
          <div style={{ color:"#F5C200", fontSize:10, fontWeight:800, letterSpacing:2 }}>CONSTRUCTION SCHEDULE</div>
          <div style={{ color:"#fff", fontSize:15, fontWeight:900 }}>
            {colDates[0].getMonth()+1}月〜{colDates[viewDays-1].getMonth()+1}月 工程表
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:2 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:statusColor }}/>
            <span style={{ color:statusColor, fontSize:10, fontWeight:700 }}>{statusLabel}</span>
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:5, alignItems:"flex-end" }}>
          <div style={{ display:"flex", gap:4 }}>
            {[7,14,28].map(n=>(
              <button key={n} onClick={()=>setViewDays(n)} style={{
                padding:"4px 9px", borderRadius:6, border:"none", cursor:"pointer",
                background: viewDays===n?"#F5C200":"rgba(255,255,255,0.15)",
                color: viewDays===n?"#192536":"#fff", fontWeight:800, fontSize:11,
              }}>{n}日</button>
            ))}
          </div>
          <button onClick={handleShare} style={{
            background: copied?"#22A86E":"rgba(255,255,255,0.15)",
            color:"#fff", border:"none", borderRadius:6,
            padding:"4px 10px", fontSize:11, fontWeight:700, cursor:"pointer",
          }}>
            {copied ? "✓ コピー済み" : "🔗 URLを共有"}
          </button>
        </div>
      </div>

      {/* Nav */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 14px 6px" }}>
        <button onClick={()=>setStartDate(d=>addDays(d,-7))} style={navBtnStyle}>◀ 前週</button>
        <span style={{ fontSize:12, color:"#555", fontWeight:700 }}>
          {colDates[0].getMonth()+1}/{colDates[0].getDate()} 〜 {colDates[viewDays-1].getMonth()+1}/{colDates[viewDays-1].getDate()}
        </span>
        <button onClick={()=>setStartDate(d=>addDays(d,7))} style={navBtnStyle}>次週 ▶</button>
      </div>

      {/* Loading */}
      {status === "loading" && (
        <div style={{ textAlign:"center", padding:"40px", color:"#888", fontSize:13 }}>
          データを読み込んでいます…
        </div>
      )}

      {/* Grid */}
      {status !== "loading" && (
        <div style={{ overflowX:"auto", padding:"0 8px 24px" }}>
          <div style={{ minWidth: viewDays <= 7 ? "100%" : viewDays * 54 }}>
            {weeks.map((week, wi) => {
              const weekOffset = wi * 7;
              const wLen = week.length;
              const pct = 100 / wLen;
              const weekTasks = laidOut.filter(t => t.endCol >= weekOffset && t.col < weekOffset + wLen);

              return (
                <div key={wi} style={{ marginBottom:6 }}>
                  <div style={{ display:"grid", gridTemplateColumns:`repeat(${wLen},1fr)`, gap:2, marginBottom:2 }}>
                    {week.map((date, di) => {
                      const dow = date.getDay();
                      const key = toKey(date);
                      const isToday = key===todayKey;
                      return (
                        <div key={di} onClick={()=>openAdd(key)} style={{
                          background: isToday?"#F5C200": dow===0?"#FFECEC": dow===6?"#ECEFFF":"#fff",
                          border: isToday?"2px solid #C8A200":"1px solid #D5D0C8",
                          borderRadius:7, padding:"4px 3px 3px", textAlign:"center",
                          cursor:"pointer", userSelect:"none",
                        }}>
                          <div style={{ fontSize:9, fontWeight:800, color:dow===0?"#B00":dow===6?"#006":"#888" }}>{DAYS_JA[dow]}</div>
                          <div style={{ fontSize:19, fontWeight:900, lineHeight:1.1, color:dow===0?"#C00":dow===6?"#006":"#1C2B3A" }}>{date.getDate()}</div>
                          <div style={{ fontSize:8, color:"#AAA" }}>{date.getMonth()+1}月</div>
                          <div style={{ fontSize:14, color:"#CCC", marginTop:1 }}>＋</div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{
                    position:"relative", height: GRID_H,
                    background:"rgba(255,255,255,0.5)", borderRadius:8, border:"1px solid #D5D0C8", overflow:"hidden",
                  }}>
                    <div style={{ position:"absolute", inset:0, display:"grid", gridTemplateColumns:`repeat(${wLen},1fr)`, pointerEvents:"none" }}>
                      {week.map((_,di)=>{
                        const dow = week[di].getDay();
                        return <div key={di} style={{
                          borderRight: di<wLen-1?"1px dashed #E0DBD3":"none",
                          background: dow===0?"rgba(200,0,0,0.04)":dow===6?"rgba(0,0,200,0.04)":"transparent",
                        }}/>;
                      })}
                    </div>

                    {weekTasks.map(t => {
                      const c = TASK_COLORS.find(x=>x.id===t.color)||TASK_COLORS[0];
                      const localStart = Math.max(t.col - weekOffset, 0);
                      const localEnd = Math.min(t.endCol - weekOffset, wLen-1);
                      const span = localEnd - localStart + 1;
                      const startsHere = t.col >= weekOffset;
                      const endsHere = t.endCol < weekOffset + wLen;
                      const isMulti = diffDays(parseKey(t.start_key), parseKey(t.end_key)) > 0;

                      return (
                        <div key={t.id}
                          onClick={()=>setModal({ start_key:t.start_key, end_key:t.end_key, text:t.text, color:t.color, editId:t.id })}
                          style={{
                            position:"absolute",
                            top: t.lane*LANE_H+4,
                            left: `calc(${localStart*pct}% + ${startsHere?3:0}px)`,
                            width: `calc(${span*pct}% - ${(startsHere?3:0)+(endsHere?3:0)}px)`,
                            height: LANE_H-4,
                            background: c.bg,
                            borderRadius: `${startsHere?5:0}px ${endsHere?5:0}px ${endsHere?5:0}px ${startsHere?5:0}px`,
                            display:"flex", alignItems:"center",
                            paddingLeft: startsHere?7:3, paddingRight: endsHere?6:3,
                            cursor:"pointer", overflow:"hidden", whiteSpace:"nowrap",
                            zIndex:10,
                            boxShadow:"0 2px 6px rgba(0,0,0,0.2)",
                            borderLeft: !startsHere?"3px solid rgba(255,255,255,0.4)":"none",
                            borderRight: !endsHere?"3px solid rgba(255,255,255,0.4)":"none",
                          }}>
                          {!startsHere && <span style={{ fontSize:10, color:"rgba(255,255,255,0.8)", marginRight:3 }}>◀</span>}
                          <span style={{ color:c.text, fontSize:10, fontWeight:700, flex:1, overflow:"hidden", textOverflow:"ellipsis" }}>
                            {isMulti && startsHere && <span style={{ marginRight:3, opacity:0.7 }}>↔</span>}
                            {t.text}
                          </span>
                          {!endsHere && <span style={{ fontSize:10, color:"rgba(255,255,255,0.8)", marginLeft:3 }}>▶</span>}
                          {endsHere && (
                            <button onClick={e=>{ e.stopPropagation(); deleteTask(t.id); }} style={{
                              marginLeft:4, background:"rgba(0,0,0,0.22)", border:"none",
                              borderRadius:3, color:"#fff", fontSize:9,
                              cursor:"pointer", padding:"1px 4px", lineHeight:1, flexShrink:0,
                            }}>✕</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ padding:"0 12px 8px", display:"flex", flexWrap:"wrap", gap:6 }}>
        {TASK_COLORS.map(c=>(
          <div key={c.id} style={{ display:"flex", alignItems:"center", gap:4 }}>
            <div style={{ width:14, height:14, borderRadius:3, background:c.bg }}/>
            <span style={{ fontSize:11, color:"#555", fontWeight:600 }}>{c.label}</span>
          </div>
        ))}
      </div>

      {/* 共有バナー */}
      <div style={{
        margin:"0 12px 24px", background:"#fff", borderRadius:10,
        border:"1px solid #D5D0C8", padding:"10px 14px",
        display:"flex", alignItems:"center", gap:10,
      }}>
        <span style={{ fontSize:20 }}>👥</span>
        <div>
          <div style={{ fontSize:12, fontWeight:800, color:"#192536" }}>リアルタイム共有中</div>
          <div style={{ fontSize:11, color:"#888" }}>編集内容は全員に即時反映されます。右上「URLを共有」で職人さんへ送れます。</div>
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:500 }}
          onClick={()=>setModal(null)}>
          <div style={{ background:"#fff", borderRadius:"20px 20px 0 0", padding:"24px 20px 48px", width:"100%", maxWidth:520, boxShadow:"0 -8px 32px rgba(0,0,0,0.2)" }}
            onClick={e=>e.stopPropagation()}>

            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
              <div style={{ fontWeight:900, fontSize:17, color:"#192536" }}>
                {modal.editId?"✏️ タスクを編集":"📝 タスクを追加"}
              </div>
              {modal.editId && (
                <button onClick={()=>deleteTask(modal.editId)} style={{
                  background:"#FDEAEA", border:"none", borderRadius:8,
                  color:"#C00", fontWeight:700, fontSize:12, padding:"6px 12px", cursor:"pointer",
                }}>🗑 削除</button>
              )}
            </div>

            <input ref={inputRef} value={modal.text}
              onChange={e=>setModal(m=>({...m,text:e.target.value}))}
              onKeyDown={e=>e.key==="Enter"&&saveTask()}
              placeholder="タスク内容（例：配筋検査 13:00）"
              style={{ width:"100%", padding:"12px 14px", borderRadius:10, border:"2px solid #E0DBD3", fontSize:14, outline:"none", boxSizing:"border-box", marginBottom:14 }}
            />

            <div style={{ display:"flex", gap:10, marginBottom:10, alignItems:"flex-end" }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:5 }}>📅 開始日</div>
                <input type="date" value={modal.start_key}
                  onChange={e=>{ const v=e.target.value; setModal(m=>({...m,start_key:v,end_key:v>m.end_key?v:m.end_key})); }}
                  style={dateInputStyle}/>
              </div>
              <div style={{ fontSize:22, color:"#C8C3BA", paddingBottom:8 }}>→</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#888", marginBottom:5 }}>🏁 終了日</div>
                <input type="date" value={modal.end_key} min={modal.start_key}
                  onChange={e=>setModal(m=>({...m,end_key:e.target.value}))}
                  style={dateInputStyle}/>
              </div>
            </div>

            {modal.start_key && modal.end_key && (
              <div style={{ textAlign:"center", marginBottom:14 }}>
                <span style={{
                  background: diffDays(parseKey(modal.start_key),parseKey(modal.end_key))>0?"#EAF0FD":"#F5F0E8",
                  color: diffDays(parseKey(modal.start_key),parseKey(modal.end_key))>0?"#1A6FE8":"#888",
                  borderRadius:20, padding:"5px 18px", fontSize:12, fontWeight:800,
                }}>
                  {diffDays(parseKey(modal.start_key),parseKey(modal.end_key))===0
                    ? "📌 単日タスク"
                    : `↔ ${diffDays(parseKey(modal.start_key),parseKey(modal.end_key))+1}日間`}
                </span>
              </div>
            )}

            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:20 }}>
              {TASK_COLORS.map(c=>(
                <button key={c.id} onClick={()=>setModal(m=>({...m,color:c.id}))} style={{
                  background:c.bg, color:c.text, border:"none", borderRadius:8,
                  padding:"7px 14px", fontWeight:800, fontSize:12, cursor:"pointer",
                  transform: modal.color===c.id?"scale(1.1)":"none",
                  boxShadow: modal.color===c.id?`0 4px 12px ${c.bg}88`:"none",
                  outline: modal.color===c.id?`3px solid ${c.bg}`:"none",
                  outlineOffset:2, transition:"all 0.12s",
                }}>{c.label}</button>
              ))}
            </div>

            <button onClick={saveTask} style={{
              width:"100%", background:"#192536", color:"#fff", border:"none",
              borderRadius:12, padding:"14px", fontWeight:900, fontSize:15,
              cursor:"pointer", boxShadow:"0 4px 14px rgba(25,37,54,0.3)",
            }}>{modal.editId?"更新する":"追加する"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtnStyle = { background:"#192536", color:"#fff", border:"none", borderRadius:8, padding:"7px 14px", fontWeight:700, fontSize:13, cursor:"pointer" };
const dateInputStyle = { width:"100%", padding:"10px 12px", borderRadius:10, border:"2px solid #E0DBD3", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit", background:"#FAFAF8" };
