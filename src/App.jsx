import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react"
import { supabase } from "./supabaseClient"
import html2canvas from "html2canvas"

const DAYS_JA = ["日","月","火","水","木","金","土"]
const COLORS = [
  { id:"orange", label:"構造",   bg:"#E8521A", darker:"#C13D0F" },
  { id:"blue",   label:"設備",   bg:"#1A6FE8", darker:"#0F4FB0" },
  { id:"green",  label:"内装",   bg:"#1A9E5C", darker:"#0F7242" },
  { id:"red",    label:"検査",   bg:"#D42020", darker:"#A01010" },
  { id:"yellow", label:"定例",   bg:"#C49800", darker:"#936F00" },
  { id:"purple", label:"搬入",   bg:"#7C3AED", darker:"#5B21B6" },
  { id:"gray",   label:"その他", bg:"#52606D", darker:"#374151" },
]

const toKey    = d    => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
const parseKey = k    => { const [y,m,d]=k.split("-"); return new Date(+y,+m-1,+d) }
const addDays  = (d,n)=> new Date(d.getFullYear(), d.getMonth(), d.getDate()+n)
const diffDays = (a,b)=> Math.round((b-a)/86400000)

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

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#EDEAE3;font-family:system-ui,"Hiragino Kaku Gothic ProN",sans-serif;min-height:100vh}
.kh-header{background:#192536;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:400;box-shadow:0 2px 12px rgba(0,0,0,0.4)}
.kh-htitle{color:#F5C200;font-size:10px;font-weight:800;letter-spacing:2px}
.kh-hmonth{color:#fff;font-size:15px;font-weight:900}
.kh-hmode{color:#22A86E;font-size:10px;font-weight:700;margin-top:1px}
.kh-day-btns{display:flex;gap:4px}
.kh-day-btn{padding:4px 9px;border-radius:6px;border:none;cursor:pointer;font-weight:800;font-size:11px;min-height:32px;touch-action:manipulation}
@media (max-width: 768px) {
  .kh-day-btn{min-height:38px;padding:5px 10px}
}
.kh-tabs{display:flex;background:#192536;border-bottom:2px solid #0f1a27}
.kh-tab{flex:1;padding:9px 0;text-align:center;font-size:13px;font-weight:700;color:rgba(255,255,255,0.5);cursor:pointer;border:none;background:transparent;border-bottom:3px solid transparent;transition:all 0.15s}
.kh-tab.active{color:#F5C200;border-bottom-color:#F5C200}
.kh-filter-bar{background:#fff;padding:8px 12px;display:flex;gap:8px;align-items:center;border-bottom:1px solid #E0DBD3;flex-wrap:wrap;-webkit-overflow-scrolling:touch}
.kh-filter-bar input{flex:1;min-width:100px;padding:6px 10px;border-radius:20px;border:1.5px solid #D5D0C8;font-size:13px;outline:none;background:#FAFAF8}
.kh-filter-bar input:focus{border-color:#192536}
.kh-filter-chips{display:flex;gap:4px;flex-wrap:wrap}
.kh-chip{padding:4px 10px;border-radius:20px;border:none;font-size:11px;font-weight:700;cursor:pointer;background:#EEE;color:#555;transition:all 0.12s}
.kh-chip.active{color:#fff}
.kh-filter-clear{padding:4px 10px;border-radius:20px;border:1.5px solid #D5D0C8;font-size:11px;font-weight:700;cursor:pointer;background:#fff;color:#888;white-space:nowrap}
.kh-nav{display:flex;align-items:center;justify-content:space-between;padding:8px 14px 4px}
.kh-nav-btn{background:#192536;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer}
@media (max-width: 768px) {
  .kh-nav-btn{min-height:44px;min-width:44px}
}
.kh-nav-label{font-size:12px;color:#555;font-weight:700}
.kh-zoom-hint{text-align:center;font-size:11px;color:#888;padding:2px 0 4px}
.kh-grid-wrap{padding:0 8px 16px}
.kh-week-block{margin-bottom:8px}
.kh-day-header{display:grid;gap:2px;margin-bottom:2px}
.kh-day-cell{background:#fff;border:1px solid #D5D0C8;border-radius:5px;padding:4px 5px;cursor:pointer;user-select:none;display:flex;align-items:center;justify-content:space-between;min-height:32px;overflow:hidden}
.kh-day-cell:hover{opacity:0.85}
.kh-day-cell.today{background:#F5C200;border:2px solid #C8A200}
.kh-day-cell.sun{background:#FFECEC}
.kh-day-cell.sat{background:#ECEFFF}
.kh-day-left{display:flex;align-items:baseline;gap:1px;white-space:nowrap}
.kh-dow{font-size:10px;font-weight:700;color:#888;flex-shrink:0}
.kh-dow.sun{color:#B00}.kh-dow.sat{color:#006}
.kh-dnum{font-size:14px;font-weight:900;color:#1C2B3A;flex-shrink:0}
.kh-dnum.sun{color:#C00}.kh-dnum.sat{color:#006}
.kh-dmonth{font-size:11px;color:#666;font-weight:700;flex-shrink:0}
.kh-plus{font-size:12px;color:#BBB;flex-shrink:0}
@media (max-width: 768px) {
  .kh-day-cell{padding:3px 4px;min-height:28px}
  .kh-dmonth{font-size:10px}
  .kh-dnum{font-size:12px}
  .kh-dow{font-size:9px}
  .kh-plus{font-size:10px}
}
.kh-task-area{position:relative;background:rgba(255,255,255,0.5);border-radius:6px;border:1px solid #D5D0C8;overflow:hidden}
.kh-col-grid{position:absolute;inset:0;display:grid;pointer-events:none}
.kh-col-div{border-right:1px dashed #E0DBD3}
.kh-task-bar{position:absolute;display:flex;align-items:center;cursor:pointer;overflow:hidden;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.2);font-size:9px;font-weight:700;color:#fff;transition:opacity 0.15s;touch-action:manipulation}
.kh-task-bar:hover{opacity:0.88}
.kh-task-bar.resizing{opacity:0.9;box-shadow:0 2px 12px rgba(0,0,0,0.35)}
.kh-task-bar.done{opacity:0.4}
.kh-resize-handle{position:absolute;top:0;bottom:0;width:9px;z-index:20;cursor:col-resize;background:transparent;display:flex;align-items:center;justify-content:center;touch-action:none}
.kh-resize-handle::after{content:"";display:block;width:2px;height:60%;background:rgba(255,255,255,0.5);border-radius:2px}
.kh-resize-handle:hover::after{background:rgba(255,255,255,0.9)}
.kh-resize-handle-left{left:0;border-radius:4px 0 0 4px}
.kh-resize-handle-right{right:0;border-radius:0 4px 4px 0}
@media (max-width: 768px) {
  .kh-resize-handle{width:20px}
  .kh-resize-handle::after{width:3px;height:55%}
}
.kh-task-bar.done .kh-bar-text{text-decoration:line-through}
.kh-done-check{flex-shrink:0;width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,0.8);background:transparent;margin-left:3px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;transition:background 0.15s;touch-action:manipulation}
.kh-done-check.checked{background:rgba(255,255,255,0.9);color:#1A9E5C}
@media (max-width: 768px) {
  .kh-done-check{width:20px;height:20px;font-size:10px}
}
.kh-legend{padding:4px 12px 16px;display:flex;flex-wrap:wrap;gap:6px}
.kh-legend-item{display:flex;align-items:center;gap:4px;font-size:11px;color:#555;font-weight:600}
.kh-legend-dot{width:12px;height:12px;border-radius:3px;flex-shrink:0}
.kh-day-view{padding:12px}
.kh-dv-header{font-size:13px;font-weight:800;color:#192536;margin-bottom:10px;display:flex;align-items:center;gap:6px}
.kh-dv-badge{background:#F5C200;color:#192536;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:800}
.kh-dv-empty{background:#fff;border-radius:10px;padding:32px;text-align:center;color:#AAA;font-size:14px;border:1px solid #E0DBD3}
.kh-card{background:#fff;border-radius:10px;border:1px solid #E0DBD3;margin-bottom:8px;overflow:hidden;display:flex;align-items:stretch;box-shadow:0 2px 8px rgba(0,0,0,0.06);transition:opacity 0.2s}
.kh-card.done{opacity:0.5}
.kh-card-accent{width:6px;flex-shrink:0}
.kh-card-body{flex:1;padding:12px 14px;cursor:pointer}
.kh-card-title{font-size:16px;font-weight:800;color:#192536;margin-bottom:4px}
.kh-card.done .kh-card-title{text-decoration:line-through}
.kh-card-meta{font-size:12px;color:#888;display:flex;gap:8px;flex-wrap:wrap}
.kh-card-right{display:flex;align-items:center;padding:0 14px}
.kh-card-done-btn{width:36px;height:36px;border-radius:50%;border:2.5px solid #D5D0C8;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;transition:all 0.15s;color:transparent}
.kh-card-done-btn.checked{background:#1A9E5C;border-color:#1A9E5C;color:#fff}
.kh-dv-summary{text-align:center;font-size:12px;color:#888;padding:8px 0;font-weight:600}
.kh-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center;z-index:500}
.kh-modal{background:#fff;border-radius:20px 20px 0 0;padding:24px 20px 40px;width:100%;max-width:520px;max-height:92vh;overflow-y:auto}
.kh-modal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.kh-modal-title{font-weight:900;font-size:17px;color:#192536}
.kh-del-btn{background:#FDEAEA;border:none;border-radius:8px;color:#C00;font-weight:700;font-size:12px;padding:6px 12px;cursor:pointer}
.kh-field-label{font-size:11px;font-weight:700;color:#888;margin-bottom:5px}
.kh-task-input{width:100%;padding:12px 14px;border-radius:10px;border:2px solid #E0DBD3;font-size:14px;outline:none;margin-bottom:14px;font-family:inherit}
.kh-task-input:focus{border-color:#192536}
@media (max-width: 768px) {
  .kh-task-input{font-size:16px}
  .kh-memo-input{font-size:16px}
  .kh-filter-bar input{font-size:16px}
}
.kh-assignee-wrap{margin-bottom:14px}
.kh-assignee-row{display:flex;gap:8px;margin-bottom:6px}
.kh-assignee-input{flex:1;padding:10px 12px;border-radius:10px;border:2px solid #E0DBD3;font-size:13px;outline:none;font-family:inherit;background:#FAFAF8;min-width:0}
.kh-assignee-input:focus{border-color:#192536}
@media (max-width: 768px) {
  .kh-assignee-row{flex-direction:column;gap:6px}
  .kh-assignee-input{font-size:16px}
}
.kh-history-label{font-size:10px;font-weight:700;color:#AAA;margin:8px 0 5px;letter-spacing:0.5px}
.kh-assignee-history{display:flex;gap:6px;flex-wrap:wrap}
.kh-history-item{display:inline-flex;align-items:center;border-radius:20px;border:1.5px solid #D5D0C8;background:#FAFAF8;overflow:hidden;font-size:11px;font-weight:600}
.kh-history-name{padding:4px 8px 4px 12px;cursor:pointer;color:#444;border:none;background:transparent;font-family:inherit;font-size:11px;font-weight:600;white-space:nowrap}
.kh-history-name:hover{color:#192536}
.kh-history-del{padding:4px 9px 4px 2px;cursor:pointer;color:#CCC;border:none;background:transparent;font-size:13px;line-height:1}
.kh-history-del:hover{color:#D42020}
.kh-date-row{display:flex;gap:10px;margin-bottom:14px;align-items:flex-end}
.kh-date-col{flex:1}
.kh-date-input{width:100%;padding:10px 12px;border-radius:10px;border:2px solid #E0DBD3;font-size:13px;outline:none;font-family:inherit;background:#FAFAF8}
@media (max-width: 768px) {
  .kh-date-row{flex-direction:column;gap:6px;align-items:stretch}
  .kh-date-col{flex:none}
  .kh-date-input{font-size:16px;padding:12px 14px}
  .kh-date-arrow{display:none}
}
.kh-color-btns{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
.kh-color-btn{border:none;border-radius:8px;padding:7px 12px;font-weight:800;font-size:12px;cursor:pointer;color:#fff;transition:transform 0.12s}
.kh-save-btn{width:100%;background:#192536;color:#fff;border:none;border-radius:12px;padding:14px;font-weight:900;font-size:15px;cursor:pointer}
.kh-memo-input{width:100%;padding:10px 12px;border-radius:10px;border:2px solid #E0DBD3;font-size:13px;outline:none;font-family:inherit;background:#FAFAF8;resize:vertical;min-height:68px;margin-bottom:14px;line-height:1.5}
.kh-memo-input:focus{border-color:#192536}
.kh-bar-memo{flex-shrink:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:9px;font-weight:600;color:#333;padding:1px 6px;background:rgba(255,255,255,0.88);pointer-events:none;line-height:14px}
.kh-card-memo{margin-top:5px;padding:6px 9px;background:#FAFAF8;border-left:3px solid #D5D0C8;border-radius:0 4px 4px 0;font-size:12px;color:#555;line-height:1.55;white-space:pre-wrap;word-break:break-all}
.kh-pt-bar-memo{font-size:8px;color:#333;line-height:1.4;padding:2px 4px;background:rgba(255,255,255,0.85);border-radius:0 0 3px 3px;overflow:hidden;white-space:pre-wrap;word-break:break-all}
.kh-preview-bg{position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end;justify-content:center;z-index:490;animation:kh-fadein 0.15s ease}
@keyframes kh-fadein{from{opacity:0}to{opacity:1}}
.kh-preview-card{background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:520px;padding:0 0 40px;box-shadow:0 -8px 40px rgba(0,0,0,0.25);animation:kh-slideup 0.2s cubic-bezier(0.34,1.2,0.64,1)}
@keyframes kh-slideup{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}
.kh-preview-accent{border-radius:24px 24px 0 0;padding:18px 20px 16px;display:flex;align-items:flex-start;justify-content:space-between}
.kh-preview-close{width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,0.25);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-left:10px;line-height:1}
.kh-preview-type-badge{display:inline-block;background:rgba(255,255,255,0.22);color:#fff;font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;margin-bottom:8px;letter-spacing:0.5px}
.kh-preview-title{color:#fff;font-size:22px;font-weight:900;line-height:1.3;word-break:break-all}
.kh-preview-body{padding:20px 20px 0}
.kh-preview-daterange{background:#F0F4FF;border-radius:14px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center}
.kh-preview-date-block{flex:1;text-align:center}
.kh-preview-date-label{font-size:10px;font-weight:800;color:#888;margin-bottom:4px;letter-spacing:0.5px}
.kh-preview-date-value{font-size:20px;font-weight:900;color:#192536;line-height:1.1}
.kh-preview-date-sub{font-size:11px;color:#888;margin-top:2px}
.kh-preview-date-arrow{font-size:22px;color:#CBD5E1;padding:0 12px;flex-shrink:0}
.kh-preview-duration{background:#192536;color:#F5C200;border-radius:20px;font-size:13px;font-weight:900;padding:4px 14px;text-align:center;margin:0 auto 16px;display:table}
.kh-preview-info-row{display:flex;gap:10px;margin-bottom:10px}
.kh-preview-info-item{flex:1;background:#F8FAFC;border-radius:12px;padding:12px 14px;border:1px solid #E2E8F0}
.kh-preview-info-label{font-size:10px;font-weight:800;color:#94A3B8;margin-bottom:5px;letter-spacing:0.5px}
.kh-preview-info-value{font-size:16px;font-weight:800;color:#1E293B;word-break:break-all}
.kh-preview-info-value.empty{color:#CBD5E1;font-size:14px;font-weight:600}
.kh-preview-done-badge{display:inline-flex;align-items:center;gap:4px;background:#DCFCE7;color:#16A34A;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:800;margin-bottom:14px}
.kh-preview-actions{display:flex;gap:10px;padding:0 20px;margin-top:20px}
.kh-preview-edit-btn{flex:1;padding:15px;background:#192536;color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.kh-preview-done-btn{padding:15px 18px;border:2px solid #E2E8F0;background:#fff;color:#64748B;border-radius:14px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:5px}
.kh-preview-done-btn.is-done{background:#DCFCE7;border-color:#86EFAC;color:#16A34A}
.kh-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#D42020;color:#fff;padding:10px 20px;border-radius:12px;font-size:13px;font-weight:700;z-index:999;box-shadow:0 4px 16px rgba(0,0,0,0.3);animation:kh-fadein 0.2s ease}
.kh-print-btn{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:#192536;color:#F5C200;border:none;font-size:22px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.3);z-index:400;display:flex;align-items:center;justify-content:center;transition:transform 0.2s}
.kh-print-btn:hover{transform:scale(1.1)}
.kh-print-tab{width:100%;height:calc(100vh - 140px);display:flex;flex-direction:column;background:#e0e0e0;overflow:hidden}
.kh-print-toolbar{background:#192536;padding:10px 20px;display:flex;align-items:center;gap:10px;flex-shrink:0;border-bottom:2px solid #F5C200;flex-wrap:wrap}
.kh-print-tool-btn{padding:8px 18px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.25);border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.15s;white-space:nowrap}
.kh-print-tool-btn:hover{background:rgba(255,255,255,0.2)}
.kh-print-execute{background:#F5C200;color:#192536;border-color:#F5C200;font-weight:900}
.kh-print-execute:hover{background:#ffd700}
.kh-print-hint{color:#64748b;font-size:11px;margin-left:auto}
@media (max-width: 768px) {
  .kh-print-toolbar{padding:6px 8px;gap:4px}
  .kh-print-tool-btn{padding:7px 10px;font-size:12px}
  .kh-print-hint{display:none}
}
.kh-pt-canvas{flex:1;overflow:auto;background:#d0d0d0;display:flex;justify-content:center;align-items:flex-start;padding:20px 16px}
.kh-pt-paper{background:#fff;width:100%;max-width:calc((100vh - 200px) * 297 / 210);aspect-ratio:297/210;padding:14px 16px;box-shadow:0 6px 28px rgba(0,0,0,0.22);flex-shrink:0;position:relative;display:flex;flex-direction:column}
.kh-pt-header{flex-shrink:0;margin-bottom:4px}
.kh-pt-title{font-size:22px;font-weight:900;color:#192536;letter-spacing:3px;text-align:center;margin-bottom:3px}
.kh-pt-subtitle{width:100%;padding:3px 8px;border:1px dashed #ccc;border-radius:4px;font-size:11px;color:#333;outline:none;background:transparent;font-family:inherit;margin-bottom:4px;display:block;resize:none;overflow:hidden;line-height:1.6;min-height:22px;word-break:break-all;white-space:pre-wrap}
.kh-pt-subtitle:focus{border-color:#192536;background:#fffef8}
.kh-pt-subtitle::placeholder{color:#ccc}
.kh-pt-legend{display:flex;justify-content:center;gap:14px;flex-wrap:wrap;margin-bottom:5px}
.kh-pt-legend-item{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#333}
.kh-pt-legend-dot{width:13px;height:13px;border-radius:2px;flex-shrink:0}
.kh-pt-calendar{border:2px solid #222;width:100%;display:flex;flex-direction:column;flex:1;min-height:0}
.kh-pt-dow-row{display:grid;grid-template-columns:repeat(7,1fr);border-bottom:2px solid #222;flex-shrink:0}
.kh-pt-dow-cell{padding:4px 2px;text-align:center;font-size:12px;font-weight:900;background:#192536;color:#F5C200;border-right:1px solid #444}
.kh-pt-dow-cell:last-child{border-right:none}
.kh-pt-dow-cell.sun{color:#ff9999}
.kh-pt-dow-cell.sat{color:#aaccff}
.kh-pt-week{border-bottom:1px solid #aaa;flex:1;display:flex;flex-direction:column;min-height:0}
.kh-pt-week:last-child{border-bottom:none}
.kh-pt-date-row{display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid #ddd;flex-shrink:0}
.kh-pt-date-cell{padding:3px 5px;border-right:1px solid #ddd;background:#fff}
.kh-pt-date-cell:last-child{border-right:none}
.kh-pt-date-cell.sun{background:#fff2f2}
.kh-pt-date-cell.sat{background:#f2f4ff}
.kh-pt-date-cell.today{background:#fffde6;box-shadow:inset 0 0 0 2px #F5C200}
.kh-pt-date-num{font-size:15px;font-weight:900;color:#1C2B3A;line-height:1.1;display:inline}
.kh-pt-date-cell.sun .kh-pt-date-num{color:#c00}
.kh-pt-date-cell.sat .kh-pt-date-num{color:#006}
.kh-pt-date-cell.today .kh-pt-date-num{color:#b08000}
.kh-pt-date-month{font-size:9px;font-weight:700;color:#999;margin-left:3px}
.kh-pt-gantt{position:relative;width:100%;background:#f8f8f8;flex:1;min-height:0}
.kh-pt-col-line{position:absolute;top:0;bottom:0;width:1px;background:rgba(0,0,0,0.07);pointer-events:none}
.kh-pt-bar{position:absolute;display:flex;align-items:center;overflow:hidden;font-size:10px;font-weight:700;color:#fff;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.22)}
.kh-pt-bar.done{opacity:0.38}
.kh-pt-bar-inner{display:flex;flex-direction:column;padding:1px 5px;overflow:hidden;flex:1;min-width:0}
.kh-pt-bar-person{font-size:8px;font-weight:900;line-height:1.1;overflow:hidden;text-overflow:ellipsis;opacity:0.92}
.kh-pt-bar-name{font-size:9px;font-weight:700;line-height:1.2;overflow:hidden;text-overflow:ellipsis}
.kh-pt-bar-cont{font-size:8px;opacity:0.6;overflow:hidden;text-overflow:ellipsis}
.kh-pt-bar-arrow{flex-shrink:0;font-size:10px;padding-right:4px;line-height:1}
.kh-pt-bar-startmark{flex-shrink:0;font-size:10px;padding-left:3px;opacity:0.7;line-height:1}
.kh-pt-memo{position:absolute;background:#fff9c4;border:2px solid #ffd700;border-radius:6px;padding:0;cursor:move;box-shadow:0 2px 6px rgba(0,0,0,0.15);color:#000;font-weight:600;min-width:100px;user-select:none;z-index:10;font-size:12px;display:flex;flex-direction:column;touch-action:none}
.kh-pt-memo-toolbar{display:flex;align-items:center;gap:2px;background:#ffd700;padding:2px 4px;border-radius:4px 4px 0 0;flex-shrink:0}
.kh-pt-memo-toolbar button{background:#fff;border:none;padding:2px 7px;font-size:10px;font-weight:700;cursor:pointer;border-radius:3px;line-height:1.4;min-height:28px;min-width:28px}
.kh-pt-memo-toolbar button:hover{background:#192536;color:#F5C200}
@media (max-width: 768px) {
  .kh-pt-memo-toolbar button{padding:4px 10px;font-size:12px;min-height:36px;min-width:36px}
}
.kh-pt-memo-del{background:#D42020 !important;color:#fff !important;margin-left:auto}
.kh-pt-memo-del:hover{background:#a00 !important;color:#fff !important}
.kh-pt-memo-body{padding:5px 9px;line-height:1.5}
@media print {
  @page{size:A4 landscape;margin:4mm 6mm}
  body{background:#fff;margin:0;padding:0}
  .kh-header,.kh-tabs,.kh-filter-bar,.kh-nav,.kh-zoom-hint,.kh-modal-bg,.kh-preview-bg,.kh-toast,.kh-print-btn,.kh-day-btns,.kh-print-toolbar{display:none !important}
  .kh-print-tab{height:auto !important;overflow:visible !important;display:block !important}
  .kh-pt-canvas{display:block !important;overflow:visible !important;padding:0 !important;background:#fff !important}
  .kh-pt-paper{max-width:none !important;width:100% !important;aspect-ratio:auto !important;height:calc(210mm - 8mm) !important;padding:3mm 4mm !important;box-shadow:none !important}
  .kh-pt-subtitle{border:none !important;padding:0 !important;background:transparent !important;margin-bottom:2px}
  .kh-pt-legend{gap:8px;margin-bottom:4px}
  .kh-pt-gantt{overflow:visible}
  .kh-pt-bar{box-shadow:none}
  .kh-pt-memo{background:transparent !important;border:none !important;box-shadow:none !important}
  .kh-pt-memo-toolbar{display:none !important}
  .kh-pt-memo-body{padding:0 !important}

  /* 28日（4週）*/
  .kh-pt-paper[data-weeks="4"] .kh-pt-title{font-size:14px;letter-spacing:1px;margin-bottom:2px}
  .kh-pt-paper[data-weeks="4"] .kh-pt-subtitle{font-size:8px}
  .kh-pt-paper[data-weeks="4"] .kh-pt-legend-item{font-size:8px}
  .kh-pt-paper[data-weeks="4"] .kh-pt-legend-dot{width:9px;height:9px}
  .kh-pt-paper[data-weeks="4"] .kh-pt-dow-cell{padding:2px 1px;font-size:9px}
  .kh-pt-paper[data-weeks="4"] .kh-pt-date-cell{padding:1px 2px}
  .kh-pt-paper[data-weeks="4"] .kh-pt-date-num{font-size:11px}
  .kh-pt-paper[data-weeks="4"] .kh-pt-bar-name{font-size:8px}
  .kh-pt-paper[data-weeks="4"] .kh-pt-bar-person{font-size:7px}
  .kh-pt-paper[data-weeks="4"] .kh-pt-bar-memo{font-size:7px}
  .kh-pt-paper[data-weeks="4"] .kh-pt-memo{font-size:7px}

  /* 14日（2週）*/
  .kh-pt-paper[data-weeks="2"] .kh-pt-title{font-size:18px;letter-spacing:2px;margin-bottom:3px}
  .kh-pt-paper[data-weeks="2"] .kh-pt-subtitle{font-size:10px}
  .kh-pt-paper[data-weeks="2"] .kh-pt-legend-item{font-size:10px}
  .kh-pt-paper[data-weeks="2"] .kh-pt-legend-dot{width:11px;height:11px}
  .kh-pt-paper[data-weeks="2"] .kh-pt-dow-cell{padding:5px 2px;font-size:12px}
  .kh-pt-paper[data-weeks="2"] .kh-pt-date-cell{padding:3px 4px}
  .kh-pt-paper[data-weeks="2"] .kh-pt-date-num{font-size:15px}
  .kh-pt-paper[data-weeks="2"] .kh-pt-bar-name{font-size:11px}
  .kh-pt-paper[data-weeks="2"] .kh-pt-bar-person{font-size:9px}
  .kh-pt-paper[data-weeks="2"] .kh-pt-bar-memo{font-size:9px}
  .kh-pt-paper[data-weeks="2"] .kh-pt-memo{font-size:10px}

  /* 7日（1週）*/
  .kh-pt-paper[data-weeks="1"] .kh-pt-title{font-size:22px;letter-spacing:3px;margin-bottom:4px}
  .kh-pt-paper[data-weeks="1"] .kh-pt-subtitle{font-size:12px}
  .kh-pt-paper[data-weeks="1"] .kh-pt-legend-item{font-size:12px}
  .kh-pt-paper[data-weeks="1"] .kh-pt-legend-dot{width:14px;height:14px}
  .kh-pt-paper[data-weeks="1"] .kh-pt-dow-cell{padding:8px 2px;font-size:16px}
  .kh-pt-paper[data-weeks="1"] .kh-pt-date-cell{padding:5px 6px}
  .kh-pt-paper[data-weeks="1"] .kh-pt-date-num{font-size:20px}
  .kh-pt-paper[data-weeks="1"] .kh-pt-bar-name{font-size:14px}
  .kh-pt-paper[data-weeks="1"] .kh-pt-bar-person{font-size:11px}
  .kh-pt-paper[data-weeks="1"] .kh-pt-bar-memo{font-size:11px}
  .kh-pt-paper[data-weeks="1"] .kh-pt-memo{font-size:12px}
}
`

// ────────────────────────────────────────────────
// DayView
// ────────────────────────────────────────────────
const DayView = memo(function DayView({ which, filteredTasks, toggleDone, setPreviewTask, now, todayKey }) {
  const targetDate = which === "tomorrow" ? addDays(now, 1) : now
  const targetKey  = toKey(targetDate)
  const month = targetDate.getMonth() + 1
  const date  = targetDate.getDate()
  const dow   = DAYS_JA[targetDate.getDay()]
  const label = which === "tomorrow" ? "明日の作業" : "本日の作業"

  const dayTasks = filteredTasks.filter(t => {
    const s = parseKey(t.start_key), e = parseKey(t.end_key), target = parseKey(targetKey)
    return target >= s && target <= e
  })
  const doneCount = dayTasks.filter(t => t.done).length

  return (
    <div className="kh-day-view">
      <div className="kh-dv-header">
        <span>{label}</span>
        <span className="kh-dv-badge">{month}月{date}日（{dow}）</span>
        <span style={{fontSize:11,color:"#888",fontWeight:600}}>{dayTasks.length}件</span>
      </div>
      {dayTasks.length === 0 ? (
        <div className="kh-dv-empty">📋 {label}はありません<br/>
          <span style={{fontSize:12,color:"#BBB",marginTop:6,display:"block"}}>工程表タブから追加できます</span>
        </div>
      ) : (
        <>
          {dayTasks.map(t => {
            const c = COLORS.find(x => x.id === t.color) || COLORS[0]
            const days = diffDays(parseKey(t.start_key), parseKey(t.end_key))
            return (
              <div key={t.id} className={`kh-card${t.done ? " done" : ""}`}>
                <div className="kh-card-accent" style={{background:c.bg}}/>
                <div className="kh-card-body" onClick={() => setPreviewTask(t)}>
                  <div className="kh-card-title">{t.text}</div>
                  <div className="kh-card-meta">
                    <span>🏗 {c.label}</span>
                    <span>🏢 {t.assignee || "未設定"}</span>
                    {days > 0 && <span>📆 {days + 1}日間</span>}
                  </div>
                  {t.memo && (
                    <div className="kh-card-memo" style={{borderLeftColor: c.bg}}>
                      📝 {t.memo}
                    </div>
                  )}
                </div>
                <div className="kh-card-right">
                  <button className={`kh-card-done-btn${t.done ? " checked" : ""}`}
                    onClick={e => { e.stopPropagation(); toggleDone(t.id) }}
                    aria-label={t.done ? "未完了に戻す" : "完了にする"}>✓</button>
                </div>
              </div>
            )
          })}
          {doneCount > 0 && (
            <div className="kh-dv-summary">✅ {doneCount}件完了 / {dayTasks.length}件中</div>
          )}
        </>
      )}
    </div>
  )
})

// ────────────────────────────────────────────────
// ScheduleView
// ────────────────────────────────────────────────
const ScheduleView = memo(function ScheduleView({
  filteredTasks, viewDays, base, navLabel, colDates,
  toggleDone, deleteTaskById, setNavOffset, openModal, setPreviewTask, isMobile, todayKey,
  resizeTask
}) {
  const dragRef = useRef(null)
  const [pendingResize, setPendingResize] = useState(null)

  const laidOut = useMemo(() => {
    const tasks = pendingResize
      ? filteredTasks.map(t => t.id === pendingResize.id
          ? {...t, start_key: pendingResize.startKey, end_key: pendingResize.endKey}
          : t)
      : filteredTasks
    return layoutTasks(tasks, viewDays, base)
  }, [filteredTasks, pendingResize, viewDays, base])

  const maxLane  = laidOut.reduce((m, t) => Math.max(m, t.lane), -1)
  const BAR_H    = 22
  const MEMO_H   = 14  // メモ行の高さ
  const LANE_H   = BAR_H + MEMO_H + 8  // バー + メモ + 余白
  // メモがあるレーンはMEMO_H分追加
  const laneHeights = useMemo(() => {
    const arr = Array(maxLane + 1).fill(BAR_H + 8)
    laidOut.forEach(t => { if (t.memo && t.lane <= maxLane) arr[t.lane] = BAR_H + MEMO_H + 8 })
    return arr
  }, [laidOut, maxLane])
  const laneOffsets = useMemo(() => {
    const offsets = []
    let acc = 0
    for (let i = 0; i <= maxLane; i++) { offsets.push(acc); acc += laneHeights[i] }
    return offsets
  }, [laneHeights, maxLane])
  const GRID_H = Math.max((laneOffsets[maxLane] ?? 0) + (laneHeights[maxLane] ?? 0) + 8, 56)

  const startResize = useCallback((e, task, edge, containerEl, wLen) => {
    e.stopPropagation()
    e.preventDefault()

    // 全週のブロック（日付ヘッダー＋タスクエリア）の位置をドラッグ開始時に取得
    const gridWrap = containerEl.closest('.kh-grid-wrap')
    const taskAreas = gridWrap ? Array.from(gridWrap.querySelectorAll('.kh-week-block')) : [containerEl]
    const weekBounds = taskAreas.map(el => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, width: r.width }
    })
    const colW = weekBounds[0].width / wLen

    dragRef.current = {
      edge, origTask: task, colW, weekBounds, wLen, base,
      currentStart: task.start_key, currentEnd: task.end_key,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev) => {
      const d = dragRef.current
      if (!d) return

      // カーソルがどの週の行にあるかをY座標で判定（最近傍の週にフォールバック）
      let weekIdx = d.weekBounds.findIndex(b => ev.clientY >= b.top && ev.clientY < b.bottom)
      if (weekIdx === -1) {
        let minDist = Infinity
        d.weekBounds.forEach((b, i) => {
          const mid = (b.top + b.bottom) / 2
          const dist = Math.abs(ev.clientY - mid)
          if (dist < minDist) { minDist = dist; weekIdx = i }
        })
      }

      // その週の中でのX位置から日を算出
      const wb = d.weekBounds[weekIdx]
      const xWithin = ev.clientX - wb.left
      const dayInWeek = Math.max(0, Math.min(d.wLen - 1, Math.floor(xWithin / d.colW)))
      const absDay = weekIdx * d.wLen + dayInWeek
      const newDate = addDays(d.base, absDay)
      const newKey  = toKey(newDate)

      let newStart = d.origTask.start_key
      let newEnd   = d.origTask.end_key
      if (d.edge === 'right') {
        if (newDate >= parseKey(d.origTask.start_key)) newEnd = newKey
      } else {
        if (newDate <= parseKey(d.origTask.end_key)) newStart = newKey
      }

      if (newStart !== d.currentStart || newEnd !== d.currentEnd) {
        d.currentStart = newStart
        d.currentEnd   = newEnd
        setPendingResize({id: d.origTask.id, startKey: newStart, endKey: newEnd})
      }
    }

    const onUp = () => {
      const d = dragRef.current
      if (!d) return
      resizeTask(d.origTask.id, d.currentStart, d.currentEnd)
      dragRef.current = null
      setPendingResize(null)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [resizeTask, base])

  const weeks = []
  for (let i = 0; i < viewDays; i += 7) weeks.push({ wo: i, days: colDates.slice(i, i + 7) })

  return (
    <>
      <div className="kh-print-header">工程表 - {navLabel}</div>
      <div className="kh-nav">
        <button className="kh-nav-btn" onClick={() => setNavOffset(o => o - 1)} aria-label="前週に移動">◀ 前週</button>
        <span className="kh-nav-label">{navLabel}</span>
        <button className="kh-nav-btn" onClick={() => setNavOffset(o => o + 1)} aria-label="次週に移動">次週 ▶</button>
      </div>
      {isMobile && viewDays > 7 && (
        <div className="kh-zoom-hint">🔍 ピンチ操作で拡大できます</div>
      )}
      <div className="kh-grid-wrap">
        {weeks.map(({ wo, days: week }) => {
          const wLen = week.length
          const weekTasks = laidOut.filter(t => t.endCol >= wo && t.col < wo + wLen)
          return (
            <div key={wo} className="kh-week-block">
              <div className="kh-day-header" style={{gridTemplateColumns:`repeat(${wLen},1fr)`}}>
                {week.map((date, di) => {
                  const dow = date.getDay(), key = toKey(date), isToday = key === todayKey
                  const cls = isToday ? "today" : dow === 0 ? "sun" : dow === 6 ? "sat" : ""
                  return (
                    <div key={di} className={`kh-day-cell${cls ? " " + cls : ""}`} 
                      onClick={() => openModal(key)}
                      role="button"
                      tabIndex={0}
                      aria-label={`${date.getMonth() + 1}月${date.getDate()}日 タスクを追加`}
                      onKeyDown={e => e.key === "Enter" && openModal(key)}>
                      <div className="kh-day-left">
                        <span className="kh-dmonth">{date.getMonth() + 1}/</span>
                        <span className={`kh-dnum${dow === 0 ? " sun" : dow === 6 ? " sat" : ""}`}>{date.getDate()}</span>
                        <span className={`kh-dow${dow === 0 ? " sun" : dow === 6 ? " sat" : ""}`}>({DAYS_JA[dow]})</span>
                      </div>
                      <span className="kh-plus">＋</span>
                    </div>
                  )
                })}
              </div>
              <div className="kh-task-area" style={{height:GRID_H}}>
                <div className="kh-col-grid" style={{gridTemplateColumns:`repeat(${wLen},1fr)`}}>
                  {week.map((date, di) => (
                    <div key={di} className="kh-col-div" style={{
                      background: date.getDay() === 0 ? "rgba(200,0,0,0.04)" : date.getDay() === 6 ? "rgba(0,0,200,0.04)" : "transparent",
                      borderRight: di === wLen - 1 ? "none" : undefined
                    }}/>
                  ))}
                </div>
                {weekTasks.map(t => {
                  const c  = COLORS.find(x => x.id === t.color) || COLORS[0]
                  const ls = Math.max(t.col - wo, 0)
                  const le = Math.min(t.endCol - wo, wLen - 1)
                  const span = le - ls + 1
                  const sh = t.col >= wo, eh = t.endCol < wo + wLen
                  const isResizing = pendingResize?.id === t.id
                  const laneTop = laneOffsets[t.lane] ?? t.lane * LANE_H
                  const hasMemo = !!t.memo
                  return (
                    <div key={t.id} className={`kh-task-bar${t.done ? " done" : ""}${isResizing ? " resizing" : ""}`}
                      title={`${t.text}${t.assignee ? " ／ " + t.assignee : ""}`}
                      style={{
                        top: laneTop + 2,
                        left: `calc(${ls * 100 / wLen}% + ${sh ? 2 : 0}px)`,
                        width: `calc(${span * 100 / wLen}% - ${(sh ? 2 : 0) + (eh ? 2 : 0)}px)`,
                        height: hasMemo ? BAR_H + MEMO_H : BAR_H,
                        background: c.bg,
                        borderRadius: `${sh ? 4 : 0}px ${eh ? 4 : 0}px ${eh ? 4 : 0}px ${sh ? 4 : 0}px`,
                        paddingLeft: sh ? 14 : 2,
                        paddingRight: eh ? 14 : 2,
                        zIndex: isResizing ? 15 : 10,
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        overflow: 'hidden',
                      }}
                      onClick={() => setPreviewTask(t)}
                      role="button"
                      tabIndex={0}
                      aria-label={`タスク: ${t.text}`}
                      onKeyDown={e => e.key === "Enter" && setPreviewTask(t)}>
                      {/* バー行 */}
                      <div style={{display:'flex',alignItems:'center',height:BAR_H,flexShrink:0}}>
                        {sh && (
                          <div className="kh-resize-handle kh-resize-handle-left"
                            onPointerDown={e => startResize(e, t, 'left', e.currentTarget.closest('.kh-task-area'), wLen)}
                            onClick={e => e.stopPropagation()}
                          />
                        )}
                        {!sh && <span style={{marginRight:2,opacity:0.8,fontSize:8}}>◀</span>}
                        <span className="kh-bar-text" style={{flex:1,overflow:"hidden",textOverflow:"ellipsis"}}>
                          {t.assignee && <span style={{opacity:0.7,marginRight:2}}>{t.assignee}</span>}
                          {t.text}
                        </span>
                        {!eh && <span style={{marginLeft:2,opacity:0.8,fontSize:8}}>▶</span>}
                        {eh && (
                          <button className={`kh-done-check${t.done ? " checked" : ""}`}
                            onClick={e => { e.stopPropagation(); toggleDone(t.id) }}
                            aria-label={t.done ? "未完了に戻す" : "完了にする"}>{t.done ? "✓" : ""}</button>
                        )}
                        {eh && (
                          <div className="kh-resize-handle kh-resize-handle-right"
                            onPointerDown={e => startResize(e, t, 'right', e.currentTarget.closest('.kh-task-area'), wLen)}
                            onClick={e => e.stopPropagation()}
                          />
                        )}
                      </div>
                      {/* メモ行 */}
                      {hasMemo && sh && (
                        <div className="kh-bar-memo" style={{borderLeftColor: c.bg}}>
                          📝 {t.memo}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="kh-legend">
        {COLORS.map(c => (
          <div key={c.id} className="kh-legend-item">
            <div className="kh-legend-dot" style={{background:c.bg}}/>{c.label}
          </div>
        ))}
      </div>
    </>
  )
})

// ────────────────────────────────────────────────
// PreviewCard
// ────────────────────────────────────────────────
const PreviewCard = memo(function PreviewCard({ task, onClose, toggleDone, openModal }) {
  // Escキーでモーダルを閉じる
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  if (!task) return null
  const c = COLORS.find(x => x.id === task.color) || COLORS[0]
  const s = parseKey(task.start_key), e = parseKey(task.end_key)
  const days = diffDays(s, e)
  const { company, person } = splitAssignee(task.assignee)
  return (
    <div className="kh-preview-bg" onClick={onClose}>
      <div className="kh-preview-card" onClick={ev => ev.stopPropagation()}>
        <div className="kh-preview-accent" style={{background:c.bg}}>
          <div style={{flex:1}}>
            <div className="kh-preview-type-badge">🏗 {c.label}</div>
            <div className="kh-preview-title">{task.text}</div>
          </div>
          <button className="kh-preview-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <div className="kh-preview-body">
          {task.done && <div className="kh-preview-done-badge">✅ 完了済み</div>}
          <div className="kh-preview-daterange">
            <div className="kh-preview-date-block">
              <div className="kh-preview-date-label">📅 開始日</div>
              <div className="kh-preview-date-value">{s.getMonth() + 1}/{s.getDate()}</div>
              <div className="kh-preview-date-sub">{DAYS_JA[s.getDay()]}曜日</div>
            </div>
            <div className="kh-preview-date-arrow">→</div>
            <div className="kh-preview-date-block">
              <div className="kh-preview-date-label">🏁 終了日</div>
              <div className="kh-preview-date-value">{e.getMonth() + 1}/{e.getDate()}</div>
              <div className="kh-preview-date-sub">{DAYS_JA[e.getDay()]}曜日</div>
            </div>
          </div>
          <div className="kh-preview-duration">
            {days === 0 ? "📌 単日作業" : `📆 ${days + 1}日間（${task.start_key} 〜 ${task.end_key}）`}
          </div>
          <div className="kh-preview-info-row">
            <div className="kh-preview-info-item">
              <div className="kh-preview-info-label">🏢 会社名</div>
              <div className={`kh-preview-info-value${company ? "" : " empty"}`}>{company || "未設定"}</div>
            </div>
            <div className="kh-preview-info-item">
              <div className="kh-preview-info-label">👤 担当者</div>
              <div className={`kh-preview-info-value${person ? "" : " empty"}`}>{person || "未設定"}</div>
            </div>
          </div>
        </div>
        <div className="kh-preview-actions">
          <button className={`kh-preview-done-btn${task.done ? " is-done" : ""}`}
            onClick={() => toggleDone(task.id)}>
            {task.done ? "↩ 未完了に戻す" : "✓ 完了にする"}
          </button>
          <button className="kh-preview-edit-btn"
            onClick={() => { onClose(); openModal(task.start_key, task) }}>✏️ 編集する</button>
        </div>
      </div>
    </div>
  )
})

// ────────────────────────────────────────────────
// PrintTab - 印刷専用タブ
// ────────────────────────────────────────────────
const PrintTab = memo(function PrintTab({
  filteredTasks, base, navLabel, isMobile,
  toggleDone, deleteTaskById, setNavOffset, openModal, setPreviewTask, todayKey,
  printMemos, setPrintMemos, printViewDays, setPrintViewDays
}) {
  const canvasRef = useRef(null)
  const paperRef  = useRef(null)
  const [subtitle, setSubtitle] = useState("")
  const [printing, setPrinting] = useState(false)

  const colorList = [
    { id:"orange", label:"構造",   bg:"#E8521A", darker:"#C13D0F" },
    { id:"blue",   label:"設備",   bg:"#1A6FE8", darker:"#0F4FB0" },
    { id:"green",  label:"内装",   bg:"#1A9E5C", darker:"#0F7242" },
    { id:"red",    label:"検査",   bg:"#D42020", darker:"#A01010" },
    { id:"yellow", label:"定例",   bg:"#C49800", darker:"#936F00" },
    { id:"purple", label:"搬入",   bg:"#7C3AED", darker:"#5B21B6" },
    { id:"gray",   label:"その他", bg:"#52606D", darker:"#374151" },
  ]

  // 週数に応じたサイズ設定
  const weekCount = printViewDays / 7
  const PT_BAR  = weekCount === 1 ? 36 : weekCount === 2 ? 28 : 22
  const PT_MEMO = weekCount === 1 ? 18 : weekCount === 2 ? 14 : 12
  const DATE_H  = weekCount === 1 ? 40 : weekCount === 2 ? 30 : 24

  const colDates = Array.from({ length: printViewDays }, (_, i) => addDays(base, i))

  const laidOut = useMemo(
    () => layoutTasks(filteredTasks, printViewDays, base),
    [filteredTasks, printViewDays, base]
  )

  const weeks = []
  for (let i = 0; i < printViewDays; i += 7) weeks.push({ wo: i, days: colDates.slice(i, i + 7) })

  const titleMonth = colDates[0] ? `${colDates[0].getMonth() + 1}月` : ""

  const addMemo = () => {
    setPrintMemos([...printMemos, { id: Date.now(), text: "メモを入力", x: 100, y: 200, fontSize: 13, fontWeight: "normal" }])
  }
  const updateMemo = (id, updates) => setPrintMemos(printMemos.map(m => m.id === id ? {...m, ...updates} : m))
  const deleteMemo = (id) => setPrintMemos(printMemos.filter(m => m.id !== id))

  // 画面をそのまま画像として印刷
  const captureAndPrint = async () => {
    if (!paperRef.current || printing) return
    setPrinting(true)
    // キャプチャ前に非表示にする要素を記録
    const toolbars = paperRef.current.querySelectorAll('.kh-pt-memo-toolbar')
    try {
      // メモツールバーを一時的に非表示にしてキャプチャ
      toolbars.forEach(el => { el.style.display = 'none' })

      const canvas = await html2canvas(paperRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        onclone: (clonedDoc) => {
          // クローン内のtextareaの値をDOMに反映（html2canvasはvalue属性を読むため）
          clonedDoc.querySelectorAll('textarea').forEach(ta => {
            ta.textContent = ta.value
          })
        }
      })

      const imgData = canvas.toDataURL('image/png')
      const pw = canvas.width, ph = canvas.height

      const win = window.open('', '_blank')
      if (!win) {
        alert('ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。')
        return
      }
      // 印刷エリア：A4横(297×210mm) - 余白(左右各8mm、上8mm、下20mm)
      // = 281mm × 182mm
      // 画像のアスペクト比に合わせてどちらで制約するか計算
      const areaW = 281, areaH = 182  // mm
      const imgAspect = pw / ph
      const areaAspect = areaW / areaH
      let finalW, finalH
      if (imgAspect > areaAspect) {
        finalW = areaW; finalH = Math.floor(areaW / imgAspect)
      } else {
        finalH = areaH; finalW = Math.floor(areaH * imgAspect)
      }

      win.document.write(`<!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <title>工程表 印刷</title>
        <style>
          *{margin:0;padding:0;box-sizing:border-box}
          @page{size:A4 landscape;margin:0}
          html,body{width:297mm;height:210mm;overflow:hidden;background:#fff;padding:8mm 8mm 20mm 8mm}
          img{display:block}
        </style>
      </head><body>
        <img src="${imgData}" style="width:${finalW}mm;height:${finalH}mm" />
        <script>
          window.onload = function(){
            setTimeout(function(){ window.print(); }, 300)
          }
        </script>
      </body></html>`)
      win.document.close()
    } catch (err) {
      console.error('印刷キャプチャエラー:', err)
      alert('印刷の準備中にエラーが発生しました。')
    } finally {
      // エラーが起きても必ずツールバーを元に戻す
      toolbars.forEach(el => { el.style.display = '' })
      setPrinting(false)
    }
  }

  return (
    <div className="kh-print-tab">
      <div className="kh-print-toolbar">
        <div style={{display:'flex',gap:4,marginRight:8}}>
          {[7,14,28].map(n => (
            <button key={n} className="kh-print-tool-btn"
              style={{
                padding:'6px 12px',
                background: printViewDays === n ? '#F5C200' : 'rgba(255,255,255,0.1)',
                color: printViewDays === n ? '#192536' : '#fff',
                fontWeight: printViewDays === n ? 900 : 700,
                borderColor: printViewDays === n ? '#F5C200' : 'rgba(255,255,255,0.25)'
              }}
              onClick={() => setPrintViewDays(n)}>{n}日</button>
          ))}
        </div>
        <button className="kh-print-tool-btn" onClick={addMemo}>＋ メモ追加</button>
        <button className="kh-print-tool-btn kh-print-execute"
          onClick={captureAndPrint}
          disabled={printing}
          style={{opacity: printing ? 0.6 : 1, cursor: printing ? 'wait' : 'pointer'}}>
          {printing ? '⏳ 準備中...' : '🖨 印刷する'}
        </button>
        <span className="kh-print-hint">{isMobile ? "メモ：長押しで編集、ドラッグで移動" : "メモはドラッグで移動、ダブルクリック/長押しで編集"}</span>
      </div>
      <div className="kh-pt-canvas" ref={canvasRef}>
        <div className="kh-pt-paper" data-weeks={weekCount} ref={paperRef}>
          {/* ヘッダー */}
          <div className="kh-pt-header">
            <div className="kh-pt-title">{titleMonth}　工程表</div>
            <textarea
              className="kh-pt-subtitle"
              value={subtitle}
              rows={1}
              onChange={e => {
                setSubtitle(e.target.value)
                // 内容に合わせて高さを自動調整
                e.target.style.height = 'auto'
                e.target.style.height = e.target.scrollHeight + 'px'
              }}
              placeholder="工程フロー・備考等を入力（任意）"
            />
            <div className="kh-pt-legend">
              {colorList.map(c => (
                <div key={c.id} className="kh-pt-legend-item">
                  <div className="kh-pt-legend-dot" style={{background: c.bg}} />
                  <span>{c.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* カレンダー */}
          <div className="kh-pt-calendar">
            <div className="kh-pt-dow-row">
              {["日","月","火","水","木","金","土"].map((d,i) => (
                <div key={i} className={`kh-pt-dow-cell${i===0?" sun":i===6?" sat":""}`}>{d}</div>
              ))}
            </div>

            {weeks.map(week => {
              const wo = week.wo
              const weekTasks = laidOut.filter(t => t.col <= wo + 6 && t.endCol >= wo)
              const maxLanePt = weekTasks.reduce((m, t) => Math.max(m, t.lane), -1)
              const ptLaneH = (lane) => weekTasks.some(t => t.lane === lane && t.memo) ? PT_BAR + PT_MEMO + 6 : PT_BAR + 6
              const ptLaneOffsets = []
              let ptAcc = 0
              for (let i = 0; i <= maxLanePt; i++) { ptLaneOffsets.push(ptAcc); ptAcc += ptLaneH(i) }
              const ganttH = Math.max(ptAcc + 8, 38)

              return (
                <div key={wo} className="kh-pt-week">
                  <div className="kh-pt-date-row">
                    {week.days.map((d, idx) => {
                      const dk = toKey(d)
                      const dow = d.getDay()
                      const isToday = dk === todayKey
                      return (
                        <div key={idx} className={`kh-pt-date-cell${dow===0?" sun":dow===6?" sat":""}${isToday?" today":""}`}
                          style={{minHeight: DATE_H, fontSize: weekCount===1?18:weekCount===2?15:13}}>
                          <span className="kh-pt-date-num">{d.getDate()}</span>
                          {d.getDate() === 1 && <span className="kh-pt-date-month">{d.getMonth()+1}月</span>}
                        </div>
                      )
                    })}
                  </div>
                  <div className="kh-pt-gantt" style={{minHeight: ganttH}}>
                    {[1,2,3,4,5,6].map(i => (
                      <div key={i} className="kh-pt-col-line" style={{left:`${i/7*100}%`}} />
                    ))}
                    {weekTasks.map(t => {
                      const color = colorList.find(c => c.id === t.color) || colorList[0]
                      const weekCol    = Math.max(0, t.col - wo)
                      const weekEndCol = Math.min(6, t.endCol - wo)
                      const weekSpan   = weekEndCol - weekCol + 1
                      const isStart = t.col >= wo
                      const isEnd   = t.endCol <= wo + 6
                      const { company, person } = splitAssignee(t.assignee)
                      const label = person || company || ""
                      const borderRadius = isStart && isEnd ? '4px'
                                         : isStart          ? '4px 0 0 4px'
                                         : isEnd            ? '0 4px 4px 0' : '0'
                      const ptTop = ptLaneOffsets[t.lane] ?? t.lane * (PT_BAR + 3)
                      const hasMemoPt = !!t.memo && isStart
                      return (
                        <div
                          key={t.id}
                          className={`kh-pt-bar${t.done?" done":""}`}
                          style={{
                            left:   `${weekCol/7*100}%`,
                            width:  `${weekSpan/7*100}%`,
                            top:    ptTop + 2,
                            height: hasMemoPt ? PT_BAR + PT_MEMO : PT_BAR,
                            background: color.bg,
                            borderRadius,
                            borderRight: !isEnd ? `3px solid ${color.darker}` : undefined,
                            flexDirection: 'column',
                            alignItems: 'stretch',
                            overflow: 'hidden',
                          }}>
                          <div style={{display:'flex',alignItems:'center',height:PT_BAR,flexShrink:0,fontSize: weekCount===1?13:weekCount===2?11:9}}>
                            {!isStart && <span className="kh-pt-bar-startmark">◀</span>}
                            <div className="kh-pt-bar-inner">
                              {isStart && label && <div className="kh-pt-bar-person" style={{fontSize: weekCount===1?11:weekCount===2?9:8}}>{label}</div>}
                              {isStart
                                ? <div className="kh-pt-bar-name" style={{fontSize: weekCount===1?13:weekCount===2?11:9}}>{t.text}</div>
                                : <div className="kh-pt-bar-cont">{t.text}</div>}
                            </div>
                            {!isEnd && <span className="kh-pt-bar-arrow">▶</span>}
                          </div>
                          {hasMemoPt && (
                            <div className="kh-pt-bar-memo">📝 {t.memo}</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* メモ */}
          {printMemos.map(memo => {
            const editText = () => {
              const t = prompt("メモを入力:", memo.text)
              if (t !== null) updateMemo(memo.id, {text: t})
            }

            const startDrag = (e) => {
              if (e.target.tagName === 'BUTTON') return
              e.preventDefault()
              const el = e.currentTarget.closest('.kh-pt-memo')
              const startX = e.clientX, startY = e.clientY
              const origX = memo.x, origY = memo.y
              let dragging = false
              // タッチ操作のみ長押し編集（PCはダブルクリック）
              let longPressTimer = e.pointerType === 'touch'
                ? setTimeout(() => { longPressTimer = null; editText() }, 600)
                : null

              const cleanup = () => {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
                document.removeEventListener('pointermove', onMove)
                document.removeEventListener('pointerup', onUp)
              }
              const onMove = (ev) => {
                if (!dragging) {
                  if (Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return
                  dragging = true
                  // ドラッグ開始したら長押しキャンセル
                  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
                  el.setPointerCapture(e.pointerId)
                }
                updateMemo(memo.id, {
                  x: origX + (ev.clientX - startX),
                  y: origY + (ev.clientY - startY),
                })
              }
              const onUp = () => cleanup()

              // documentレベルで登録→要素外で離してもクリーンアップされる
              document.addEventListener('pointermove', onMove)
              document.addEventListener('pointerup', onUp)
            }

            return (
              <div key={memo.id} className="kh-pt-memo" style={{left: memo.x, top: memo.y}}>
                {/* ツールバー（常時表示） */}
                <div className="kh-pt-memo-toolbar" onPointerDown={startDrag}>
                  <button onClick={() => updateMemo(memo.id, {fontSize: (memo.fontSize||12)+2})}>A＋</button>
                  <button onClick={() => updateMemo(memo.id, {fontSize: Math.max(8, (memo.fontSize||12)-2)})}>A－</button>
                  <button style={{fontWeight:'bold'}} onClick={() => updateMemo(memo.id, {fontWeight: memo.fontWeight==="bold"?"normal":"bold"})}>B</button>
                  <button className="kh-pt-memo-del" onClick={() => deleteMemo(memo.id)}>✕</button>
                </div>
                {/* テキスト本体：ドラッグ可能、PC=ダブルクリック編集、スマホ=長押し編集 */}
                <div className="kh-pt-memo-body"
                  style={{fontSize: memo.fontSize||12, fontWeight: memo.fontWeight||'normal', cursor:'move'}}
                  onPointerDown={startDrag}
                  onDoubleClick={editText}>
                  {memo.text}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
})

// ────────────────────────────────────────────────
// EditModal
// ────────────────────────────────────────────────
const EditModal = memo(function EditModal({
  editId, taskText, setTaskText, companyInput, setCompanyInput, personInput, setPersonInput,
  memoInput, setMemoInput,
  startDate, setStartDate, endDate, setEndDate, selectedColor, setSelectedColor,
  assigneeHistory, setAssigneeHistory, saveTask, deleteTaskById, closeModal, taskTextRef
}) {
  const isEdit = editId !== null

  // Escキーでモーダルを閉じる
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") closeModal() }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [closeModal])

  // 開始日変更時は終了日を補正（開始日より前にならないように）
  const onStartChange = (v) => {
    setStartDate(v)
    if (v > endDate) setEndDate(v)
  }

  // 終了日変更時も開始日より前にならないよう補正
  const onEndChange = (v) => {
    if (v < startDate) {
      setEndDate(startDate)
    } else {
      setEndDate(v)
    }
  }

  return (
    <div className="kh-modal-bg" onClick={closeModal}>
      <div className="kh-modal" onClick={e => e.stopPropagation()}>
        <div className="kh-modal-head">
          <div className="kh-modal-title">{isEdit ? "✏️ タスクを編集" : "📝 タスク追加"}</div>
          {isEdit && (
            <button className="kh-del-btn" onClick={() => deleteTaskById(editId)}>🗑 削除</button>
          )}
        </div>
        <div className="kh-field-label">🔨 作業内容</div>
        <input ref={taskTextRef} className="kh-task-input" value={taskText}
          onChange={e => setTaskText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && saveTask()}
          placeholder="例：1F 配筋検査 13:00〜"
          aria-label="作業内容"/>
        <div className="kh-assignee-wrap">
          <div className="kh-field-label">🏢 担当</div>
          <div className="kh-assignee-row">
            <input className="kh-assignee-input" value={companyInput}
              onChange={e => setCompanyInput(e.target.value)} 
              placeholder="会社名（例：山田工務店）"
              aria-label="会社名"/>
            <input className="kh-assignee-input" value={personInput}
              onChange={e => setPersonInput(e.target.value)} 
              placeholder="担当者名（例：田中）"
              aria-label="担当者名"/>
          </div>
          {assigneeHistory.length > 0 && (
            <>
              <div className="kh-history-label">📋 履歴から選ぶ</div>
              <div className="kh-assignee-history">
                {assigneeHistory.map((h, i) => (
                  <div key={i} className="kh-history-item">
                    <button className="kh-history-name"
                      onClick={() => { setCompanyInput(h.company || ""); setPersonInput(h.person || "") }}
                      aria-label={`履歴から選択: ${h.company || ""} ${h.person || ""}`}>
                      {h.company && h.person ? `${h.company} ${h.person}` : h.company || h.person}
                    </button>
                    <button className="kh-history-del"
                      onClick={() => setAssigneeHistory(prev => prev.filter((_, j) => j !== i))}
                      aria-label="履歴を削除">×</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="kh-field-label" style={{marginBottom:8}}>🏗 工種</div>
        <div className="kh-color-btns">
          {COLORS.map(c => (
            <button key={c.id} className="kh-color-btn"
              style={{
                background: c.bg,
                transform: selectedColor === c.id ? "scale(1.1)" : "none",
                outline: selectedColor === c.id ? `3px solid ${c.bg}` : "none",
                outlineOffset: 2
              }}
              onClick={() => setSelectedColor(c.id)}
              aria-label={`工種: ${c.label}`}
              aria-pressed={selectedColor === c.id}>🏗 {c.label}</button>
          ))}
        </div>
        <div className="kh-date-row">
          <div className="kh-date-col">
            <div className="kh-field-label">📅 開始日</div>
            <input type="date" className="kh-date-input" value={startDate}
              onChange={e => onStartChange(e.target.value)}
              aria-label="開始日"/>
          </div>
          <div className="kh-date-arrow" style={{fontSize:20,color:"#C8C3BA",paddingBottom:8}}>→</div>
          <div className="kh-date-col">
            <div className="kh-field-label">🏁 終了日</div>
            <input type="date" className="kh-date-input" value={endDate}
              min={startDate}
              onChange={e => onEndChange(e.target.value)}
              aria-label="終了日"/>
          </div>
        </div>
        <div className="kh-field-label">📝 メモ（任意）</div>
        <textarea className="kh-memo-input" value={memoInput}
          onChange={e => setMemoInput(e.target.value)}
          placeholder="備考・注意事項など"
          aria-label="メモ"/>
        <button className="kh-save-btn" onClick={saveTask}>{isEdit ? "更新する" : "追加する"}</button>
      </div>
    </div>
  )
})

// ────────────────────────────────────────────────
// App (Main)
// ────────────────────────────────────────────────
export default function App() {
  const [now] = useState(() => new Date())
  const todayKey  = toKey(now)
  const baseStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())

  const [tasks, setTasks]                     = useState([])
  const [navOffset, setNavOffset]             = useState(0)
  const [viewDays, setViewDays]               = useState(28)
  const [currentTab, setCurrentTab]           = useState("schedule")
  const [filterName, setFilterName]           = useState("")
  const [filterColor, setFilterColor]         = useState("")
  const [previewTask, setPreviewTask]         = useState(null)
  const [modalOpen, setModalOpen]             = useState(false)
  const [editId, setEditId]                   = useState(null)
  const [selectedColor, setSelectedColor]     = useState("orange")
  const [taskText, setTaskText]               = useState("")
  const [companyInput, setCompanyInput]       = useState("")
  const [personInput, setPersonInput]         = useState("")
  const [memoInput, setMemoInput]             = useState("")
  const [startDate, setStartDate]             = useState("")
  const [endDate, setEndDate]                 = useState("")
  const [toastMsg, setToastMsg]               = useState("")
  
  // 印刷用メモの状態
  const [printMemos, setPrintMemos]           = useState([])
  const [printViewDays, setPrintViewDays]     = useState(28)

  // 担当者履歴をlocalStorageで永続化
  const [assigneeHistory, setAssigneeHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("kh_assignee_history") || "[]")
    } catch { return [] }
  })
  useEffect(() => {
    localStorage.setItem("kh_assignee_history", JSON.stringify(assigneeHistory))
  }, [assigneeHistory])

  const taskTextRef     = useRef(null)
  const suppressRTRef   = useRef(false)
  const suppressTimerRef = useRef(null)

  // isMobileをstateで管理しリサイズに追従
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener("resize", handler)
    return () => window.removeEventListener("resize", handler)
  }, [])

  useEffect(() => {
    const style = document.createElement("style")
    style.setAttribute("data-kh", "1")
    style.textContent = CSS
    document.head.appendChild(style)
    return () => document.head.removeChild(style)
  }, [])

  // エラートースト表示ヘルパー
  const showToast = useCallback((msg) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(""), 3000)
  }, [])

  // 印刷ハンドラー
  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  const loadTasks = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("tasks").select("*").order("start_key")
      if (error) {
        console.error("データ取得エラー:", error)
        showToast("データの取得に失敗しました")
        return
      }
      if (data) {
        setTasks(data.map(t => ({ ...t, done: t.done || false })))
        console.log(`✅ ${data.length}件のタスクを読み込みました`)
      }
    } catch (err) {
      console.error("予期しないエラー:", err)
      showToast("データの取得中にエラーが発生しました")
    }
  }, [showToast])

  useEffect(() => {
    loadTasks()
    const channel = supabase
      .channel("tasks-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tasks" }, (payload) => {
        console.log("🔔 新規タスク追加:", payload)
        if (!suppressRTRef.current) loadTasks()
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tasks" }, ({ new: rec }) => {
        console.log("🔔 タスク更新:", rec)
        if (suppressRTRef.current) return
        setTasks(prev => prev.map(t => t.id === rec.id ? { ...rec, done: rec.done || false } : t))
        setPreviewTask(prev => prev && prev.id === rec.id ? { ...rec, done: rec.done || false } : prev)
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, ({ old: rec }) => {
        console.log("🔔 タスク削除:", rec)
        setTasks(prev => prev.filter(t => t.id !== rec.id))
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [loadTasks])

  const toggleDone = useCallback(async (id) => {
    const task = tasks.find(t => t.id === id)
    if (!task) return
    const newDone = !task.done
    const prevDone = task.done
    
    // 楽観的更新
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: newDone } : t))
    setPreviewTask(prev => prev && prev.id === id ? { ...prev, done: newDone } : prev)
    
    try {
      const { error } = await supabase.from("tasks").update({ done: newDone }).eq("id", id)
      if (error) {
        console.error("完了状態更新エラー:", error)
        showToast("更新に失敗しました")
        // ロールバック
        setTasks(prev => prev.map(t => t.id === id ? { ...t, done: prevDone } : t))
        setPreviewTask(prev => prev && prev.id === id ? { ...prev, done: prevDone } : prev)
      }
    } catch (err) {
      console.error("予期しないエラー:", err)
      showToast("更新中にエラーが発生しました")
      // ロールバック
      setTasks(prev => prev.map(t => t.id === id ? { ...t, done: prevDone } : t))
      setPreviewTask(prev => prev && prev.id === id ? { ...prev, done: prevDone } : prev)
    }
  }, [tasks, showToast])

  const openModal = useCallback((dateKey, task = null) => {
    setEditId(task ? task.id : null)
    setSelectedColor(task ? task.color : "orange")
    setTaskText(task ? task.text : "")
    setStartDate(task ? task.start_key : dateKey)
    setEndDate(task ? task.end_key : dateKey)
    const { company, person } = splitAssignee(task ? task.assignee : "")
    setCompanyInput(company)
    setPersonInput(person)
    setMemoInput(task ? task.memo || "" : "")
    setModalOpen(true)
    setTimeout(() => taskTextRef.current?.focus(), 80)
  }, [])

  const closeModal = useCallback(() => setModalOpen(false), [])

  const saveTask = useCallback(async () => {
    const text = taskText.trim()
    if (!text) {
      showToast("作業内容を入力してください")
      return
    }
    
    const company  = companyInput.trim()
    const person   = personInput.trim()
    const assignee = assigneeLabel(company, person)

    if (company || person) {
      setAssigneeHistory(prev => {
        const exists = prev.some(h => h.company === company && h.person === person)
        return exists ? prev : [...prev, { company, person }]
      })
    }

    // 既存タイマーをクリアしてから再セット
    suppressRTRef.current = true
    if (suppressTimerRef.current) {
      clearTimeout(suppressTimerRef.current)
    }

    setModalOpen(false)

    try {
      const memo = memoInput.trim() || null
      if (editId) {
        const { error } = await supabase.from("tasks")
          .update({ text, assignee, start_key: startDate, end_key: endDate, color: selectedColor, memo })
          .eq("id", editId)
        if (error) {
          console.error("更新エラー:", error)
          showToast("更新に失敗しました: " + error.message)
          suppressRTRef.current = false
          await loadTasks()
          return
        }
        console.log("✅ タスクを更新しました:", editId)
      } else {
        const { error } = await supabase.from("tasks")
          .insert({ text, assignee, start_key: startDate, end_key: endDate, color: selectedColor, done: false, memo })
        if (error) {
          console.error("保存エラー:", error)
          showToast("保存に失敗しました: " + error.message)
          suppressRTRef.current = false
          await loadTasks()
          return
        }
        console.log("✅ タスクを追加しました")
      }

      await loadTasks()

      suppressTimerRef.current = setTimeout(() => {
        suppressRTRef.current = false
        console.log("✅ リアルタイム更新の抑制を解除しました")
      }, 2000)
    } catch (err) {
      console.error("予期しないエラー:", err)
      showToast("保存中にエラーが発生しました")
      suppressRTRef.current = false
      await loadTasks()
    }
  }, [taskText, companyInput, personInput, memoInput, editId, startDate, endDate, selectedColor, loadTasks, showToast])

  const resizeTask = useCallback(async (id, newStartKey, newEndKey) => {
    setTasks(prev => prev.map(t => t.id === id ? {...t, start_key: newStartKey, end_key: newEndKey} : t))
    try {
      const { error } = await supabase.from("tasks")
        .update({ start_key: newStartKey, end_key: newEndKey })
        .eq("id", id)
      if (error) {
        console.error("リサイズエラー:", error)
        showToast("更新に失敗しました")
        await loadTasks()
      }
    } catch (err) {
      console.error("リサイズエラー:", err)
      showToast("更新中にエラーが発生しました")
      await loadTasks()
    }
  }, [loadTasks, showToast])

  const deleteTaskById = useCallback(async (id) => {
    const prevTasks = tasks
    setTasks(prev => prev.filter(t => t.id !== id))
    setModalOpen(false)
    setPreviewTask(null)
    
    try {
      const { error } = await supabase.from("tasks").delete().eq("id", id)
      if (error) {
        console.error("削除エラー:", error)
        showToast("削除に失敗しました")
        setTasks(prevTasks)
        await loadTasks()
      } else {
        console.log("✅ タスクを削除しました:", id)
      }
    } catch (err) {
      console.error("予期しないエラー:", err)
      showToast("削除中にエラーが発生しました")
      setTasks(prevTasks)
      await loadTasks()
    }
  }, [tasks, loadTasks, showToast])

  const base      = addDays(baseStart, navOffset * 7)
  const colDates  = Array.from({ length: viewDays }, (_, i) => addDays(base, i))
  const headerMonth = `${colDates[0].getMonth() + 1}月〜${colDates[viewDays - 1].getMonth() + 1}月 工程表`
  const navLabel    = `${colDates[0].getMonth() + 1}/${colDates[0].getDate()} 〜 ${colDates[viewDays - 1].getMonth() + 1}/${colDates[viewDays - 1].getDate()}`

  const filteredTasks = tasks.filter(t => {
    if (filterName  && !(t.assignee || "").includes(filterName)) return false
    if (filterColor && t.color !== filterColor)                   return false
    return true
  })

  const currentPreviewTask = previewTask
    ? (tasks.find(t => t.id === previewTask.id) || previewTask)
    : null

  return (
    <div style={{minHeight:"100vh",background:"#EDEAE3"}}>
      <div className="kh-header">
        <div>
          <div className="kh-htitle">CONSTRUCTION SCHEDULE</div>
          <div className="kh-hmonth">{headerMonth}</div>
          <div className="kh-hmode">● LIVE</div>
        </div>
        {currentTab === "schedule" && (
          <div className="kh-day-btns">
            {[7, 14, 28].map(n => (
              <button key={n} className="kh-day-btn"
                style={{
                  background: viewDays === n ? "#F5C200" : "rgba(255,255,255,0.15)",
                  color: viewDays === n ? "#192536" : "#fff"
                }}
                onClick={() => setViewDays(n)}
                aria-pressed={viewDays === n}>{n}日</button>
            ))}
          </div>
        )}
      </div>
      <div className="kh-tabs">
        {[
          { id: "today",    label: "📅 今日" },
          { id: "tomorrow", label: "📆 明日" },
          { id: "schedule", label: "📋 工程表" },
          { id: "print",    label: "🖨️ 印刷" }
        ].map(tab => (
          <button key={tab.id} className={`kh-tab${currentTab === tab.id ? " active" : ""}`}
            onClick={() => {
              console.log(`タブ切り替え: ${tab.id}`)
              setCurrentTab(tab.id)
            }}
            aria-selected={currentTab === tab.id}
            role="tab">{tab.label}</button>
        ))}
      </div>
      <div className="kh-filter-bar">
        <input placeholder="🏢 担当で絞り込み" value={filterName}
          onChange={e => setFilterName(e.target.value)}
          aria-label="担当で絞り込み"/>
        <div className="kh-filter-chips">
          {COLORS.map(c => (
            <button key={c.id} className={`kh-chip${filterColor === c.id ? " active" : ""}`}
              style={filterColor === c.id ? { background: c.bg } : {}}
              onClick={() => setFilterColor(filterColor === c.id ? "" : c.id)}
              aria-pressed={filterColor === c.id}>{c.label}</button>
          ))}
        </div>
        <button className="kh-filter-clear"
          onClick={() => { setFilterName(""); setFilterColor("") }}
          aria-label="フィルタをクリア">✕ クリア</button>
      </div>

      {currentTab === "today" && (
        <DayView which="today" filteredTasks={filteredTasks}
          toggleDone={toggleDone} setPreviewTask={setPreviewTask}
          now={now} todayKey={todayKey}/>
      )}
      {currentTab === "tomorrow" && (
        <DayView which="tomorrow" filteredTasks={filteredTasks}
          toggleDone={toggleDone} setPreviewTask={setPreviewTask}
          now={now} todayKey={todayKey}/>
      )}
      {currentTab === "schedule" && (
        <ScheduleView
          filteredTasks={filteredTasks} viewDays={viewDays} base={base}
          navLabel={navLabel} colDates={colDates} isMobile={isMobile}
          toggleDone={toggleDone} deleteTaskById={deleteTaskById}
          setNavOffset={setNavOffset} openModal={openModal}
          setPreviewTask={setPreviewTask} todayKey={todayKey}
          resizeTask={resizeTask}/>
      )}
      {currentTab === "print" && (
        <PrintTab
          filteredTasks={filteredTasks} viewDays={printViewDays} base={base}
          navLabel={navLabel} isMobile={isMobile}
          toggleDone={toggleDone} deleteTaskById={deleteTaskById}
          setNavOffset={setNavOffset} openModal={openModal}
          setPreviewTask={setPreviewTask} todayKey={todayKey}
          printViewDays={printViewDays} setPrintViewDays={setPrintViewDays}
          printMemos={printMemos} setPrintMemos={setPrintMemos}/>
      )}

      {currentPreviewTask && (
        <PreviewCard task={currentPreviewTask} onClose={() => setPreviewTask(null)}
          toggleDone={toggleDone} openModal={openModal}/>
      )}
      {modalOpen && (
        <EditModal
          editId={editId} taskText={taskText} setTaskText={setTaskText}
          companyInput={companyInput} setCompanyInput={setCompanyInput}
          personInput={personInput} setPersonInput={setPersonInput}
          memoInput={memoInput} setMemoInput={setMemoInput}
          startDate={startDate} setStartDate={setStartDate}
          endDate={endDate} setEndDate={setEndDate}
          selectedColor={selectedColor} setSelectedColor={setSelectedColor}
          assigneeHistory={assigneeHistory} setAssigneeHistory={setAssigneeHistory}
          saveTask={saveTask} deleteTaskById={deleteTaskById}
          closeModal={closeModal} taskTextRef={taskTextRef}/>
      )}

      {toastMsg && <div className="kh-toast">⚠️ {toastMsg}</div>}
      
    </div>
  )
}
