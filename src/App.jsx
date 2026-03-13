import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react"
import { supabase } from "./supabaseClient"

const DAYS_JA = ["日","月","火","水","木","金","土"]
const COLORS = [
  { id:"orange", label:"構造",   bg:"#E8521A" },
  { id:"blue",   label:"設備",   bg:"#1A6FE8" },
  { id:"green",  label:"内装",   bg:"#1A9E5C" },
  { id:"red",    label:"検査",   bg:"#D42020" },
  { id:"yellow", label:"定例",   bg:"#C49800" },
  { id:"purple", label:"搬入",   bg:"#7C3AED" },
  { id:"gray",   label:"その他", bg:"#52606D" },
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
.kh-day-btn{padding:4px 9px;border-radius:6px;border:none;cursor:pointer;font-weight:800;font-size:11px}
.kh-tabs{display:flex;background:#192536;border-bottom:2px solid #0f1a27}
.kh-tab{flex:1;padding:9px 0;text-align:center;font-size:13px;font-weight:700;color:rgba(255,255,255,0.5);cursor:pointer;border:none;background:transparent;border-bottom:3px solid transparent;transition:all 0.15s}
.kh-tab.active{color:#F5C200;border-bottom-color:#F5C200}
.kh-filter-bar{background:#fff;padding:8px 12px;display:flex;gap:8px;align-items:center;border-bottom:1px solid #E0DBD3;flex-wrap:wrap}
.kh-filter-bar input{flex:1;min-width:100px;padding:6px 10px;border-radius:20px;border:1.5px solid #D5D0C8;font-size:13px;outline:none;background:#FAFAF8}
.kh-filter-bar input:focus{border-color:#192536}
.kh-filter-chips{display:flex;gap:4px;flex-wrap:wrap}
.kh-chip{padding:4px 10px;border-radius:20px;border:none;font-size:11px;font-weight:700;cursor:pointer;background:#EEE;color:#555;transition:all 0.12s}
.kh-chip.active{color:#fff}
.kh-filter-clear{padding:4px 10px;border-radius:20px;border:1.5px solid #D5D0C8;font-size:11px;font-weight:700;cursor:pointer;background:#fff;color:#888;white-space:nowrap}
.kh-nav{display:flex;align-items:center;justify-content:space-between;padding:8px 14px 4px}
.kh-nav-btn{background:#192536;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer}
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
.kh-task-bar{position:absolute;display:flex;align-items:center;cursor:pointer;overflow:hidden;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.2);font-size:9px;font-weight:700;color:#fff;transition:opacity 0.15s}
.kh-task-bar:hover{opacity:0.88}
.kh-task-bar.done{opacity:0.4}
.kh-task-bar.done .kh-bar-text{text-decoration:line-through}
.kh-done-check{flex-shrink:0;width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,0.8);background:transparent;margin-left:3px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;transition:background 0.15s}
.kh-done-check.checked{background:rgba(255,255,255,0.9);color:#1A9E5C}
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
.kh-assignee-wrap{margin-bottom:14px}
.kh-assignee-row{display:flex;gap:8px;margin-bottom:6px}
.kh-assignee-input{flex:1;padding:10px 12px;border-radius:10px;border:2px solid #E0DBD3;font-size:13px;outline:none;font-family:inherit;background:#FAFAF8;min-width:0}
.kh-assignee-input:focus{border-color:#192536}
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
.kh-color-btns{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
.kh-color-btn{border:none;border-radius:8px;padding:7px 12px;font-weight:800;font-size:12px;cursor:pointer;color:#fff;transition:transform 0.12s}
.kh-save-btn{width:100%;background:#192536;color:#fff;border:none;border-radius:12px;padding:14px;font-weight:900;font-size:15px;cursor:pointer}
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
.kh-print-header{display:none}
.kh-print-tab{width:100%;height:calc(100vh - 140px);display:flex;flex-direction:column;background:#f8f9fa;overflow:hidden}
.kh-print-toolbar{background:#192536;padding:12px 20px;display:flex;align-items:center;gap:12px;border-bottom:2px solid #F5C200;flex-shrink:0}
.kh-print-tool-btn{padding:10px 20px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;transition:all 0.2s}
.kh-print-tool-btn:hover{background:rgba(255,255,255,0.2);transform:translateY(-1px)}
.kh-print-execute{background:#F5C200;color:#192536;border-color:#F5C200}
.kh-print-execute:hover{background:#ffd700}
.kh-print-hint{color:#94a3b8;font-size:12px;margin-left:auto}
.kh-print-canvas{flex:1;position:relative;overflow:auto;background:#fff;padding:20px}
.kh-print-page-header{text-align:center;margin-bottom:16px}
.kh-print-title{font-size:24px;font-weight:900;color:#192536;margin:0 0 12px}
.kh-print-legend-bar{display:flex;justify-content:center;gap:20px;flex-wrap:wrap}
.kh-print-legend-item{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700}
.kh-print-legend-dot{width:14px;height:14px;border-radius:2px}
.kh-print-calendar{border:2px solid #000}
.kh-print-dow-header{display:grid;grid-template-columns:repeat(7,1fr);border-bottom:2px solid #000}
.kh-print-dow-cell{padding:8px;text-align:center;font-size:14px;font-weight:900;background:#e0e0e0;border-right:1px solid #000}
.kh-print-dow-cell:last-child{border-right:none}
.kh-print-dow-cell.sun{color:#c00}
.kh-print-dow-cell.sat{color:#00c}
.kh-print-week{border-bottom:1px solid #000}
.kh-print-week:last-child{border-bottom:none}
.kh-print-date-row{display:grid;grid-template-columns:repeat(7,1fr)}
.kh-print-date-cell{padding:8px 6px;border-right:1px solid #000;border-bottom:1px solid #000;min-height:80px;display:flex;flex-direction:column;gap:6px}
.kh-print-date-cell:last-child{border-right:none}
.kh-print-date-cell.sun{background:#ffe5e5}
.kh-print-date-cell.sat{background:#e5e5ff}
.kh-print-date-cell.today{background:#ffffcc;box-shadow:inset 0 0 0 2px #000}
.kh-print-date-num{font-size:20px;font-weight:900;color:#333;text-align:center;margin-bottom:4px}
.kh-print-task-list{display:flex;flex-direction:column;gap:3px;flex:1}
.kh-print-task-bar{background:#f0f0f0;border-left:4px solid #192536;padding:4px 6px;font-size:11px}
.kh-print-task-text{display:flex;flex-direction:column;gap:1px}
.kh-print-task-person{font-weight:700;font-size:10px;color:#333}
.kh-print-task-name{font-size:11px;color:#555;line-height:1.3}
.kh-print-task-continue{font-size:10px;color:#999}
.kh-print-memo{position:absolute;background:#fff9c4;border:2px solid #ffd700;border-radius:6px;padding:8px 12px;cursor:move;box-shadow:0 2px 8px rgba(0,0,0,0.15);color:#000;font-weight:600;min-width:100px;user-select:none;z-index:10}
.kh-print-memo:hover{box-shadow:0 4px 12px rgba(0,0,0,0.25)}
.kh-print-memo-delete{position:absolute;top:-10px;right:-10px;width:24px;height:24px;border-radius:50%;background:#D42020;color:#fff;border:none;font-size:14px;cursor:pointer;display:none}
.kh-print-memo:hover .kh-print-memo-delete{display:flex;align-items:center;justify-content:center}
.kh-print-memo-controls{display:none;position:absolute;bottom:-36px;left:0;background:#192536;border-radius:6px;padding:4px;gap:4px}
.kh-print-memo:hover .kh-print-memo-controls{display:flex}
.kh-print-memo-controls button{background:#fff;border:none;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;border-radius:4px}
.kh-print-memo-controls button:hover{background:#F5C200}
@media print {
  @page {
    size: A4 landscape;
    margin: 4mm 6mm;
  }
  body{background:#fff;margin:0;padding:0}
  .kh-header,.kh-tabs,.kh-filter-bar,.kh-nav,.kh-zoom-hint,.kh-modal-bg,.kh-preview-bg,.kh-toast,.kh-print-btn,.kh-day-btns,.kh-print-toolbar{display:none !important}
  .kh-print-tab{height:auto !important;overflow:visible !important;display:block !important}
  .kh-print-canvas{padding:10mm !important;overflow:visible !important;height:auto !important;flex:none !important;position:static !important}
  .kh-print-title{font-size:18px}
  .kh-print-legend-bar{gap:12px}
  .kh-print-legend-item{font-size:10px}
  .kh-print-legend-dot{width:10px;height:10px}
  .kh-print-dow-cell{padding:6px;font-size:11px}
  .kh-print-date-cell{padding:5px 4px;min-height:50px;gap:4px}
  .kh-print-date-num{font-size:16px;margin-bottom:3px}
  .kh-print-task-list{gap:2px}
  .kh-print-task-bar{font-size:8px;padding:2px 4px}
  .kh-print-task-person{font-size:7px}
  .kh-print-task-name{font-size:8px;line-height:1.2}
  .kh-print-task-continue{font-size:8px}
  .kh-print-memo{background:transparent !important;border:none !important;box-shadow:none !important;padding:2px !important;cursor:default !important}
  .kh-print-memo-delete,.kh-print-memo-controls{display:none !important}
  .kh-print-header{display:block !important;font-size:13px;font-weight:900;text-align:center;padding:1px 0;border-bottom:2px solid #000;margin-bottom:1px}
  .kh-grid-wrap{padding:0;margin:0;display:flex;flex-direction:column;min-height:0}
  .kh-week-block{page-break-inside:avoid;margin-bottom:1px;flex:1;display:flex;flex-direction:column;min-height:0}
  .kh-week-block:last-child{margin-bottom:0}
  .kh-day-header{display:grid;gap:0.5px;margin-bottom:0.5px;grid-template-columns:repeat(7,1fr);flex-shrink:0}
  .kh-day-cell{background:#fff;border:1px solid #000;border-radius:0;padding:0.5px 1px;min-height:auto;cursor:default}
  .kh-day-cell:hover{opacity:1}
  .kh-day-cell.today{background:#ffffcc;border:2px solid #000}
  .kh-day-cell.sun{background:#ffe5e5;border-color:#000}
  .kh-day-cell.sat{background:#e5e5ff;border-color:#000}
  .kh-day-left{gap:0.5px;display:flex;flex-direction:column}
  .kh-dmonth{font-size:7px;font-weight:700;color:#000;line-height:1}
  .kh-dnum{font-size:10px;font-weight:900;color:#000;line-height:1}
  .kh-dow{font-size:6px;font-weight:700;color:#000;line-height:1}
  .kh-plus{display:none}
  .kh-task-area{display:block !important;position:relative;background:#fff;border:1px solid #000;border-top:none;flex:1;min-height:50px;overflow:visible}
  .kh-col-grid{display:none}
  .kh-task-bar{box-shadow:none;border:1px solid #000;font-size:7px;font-weight:900;padding:1px 2px !important;color:#000 !important;line-height:1.1;min-height:12px}
  .kh-task-bar .kh-bar-text{font-size:7px;line-height:1.1;font-weight:900;color:#000 !important}
  .kh-task-bar .kh-bar-text span{color:#000 !important;opacity:1 !important}
  .kh-done-check{display:none}
  .kh-legend{display:flex !important;padding:1px 0 0;gap:4px;justify-content:center;page-break-before:avoid;page-break-inside:avoid;flex-shrink:0}
  .kh-legend-item{font-size:7px;font-weight:700;color:#000}
  .kh-legend-dot{width:8px;height:8px;border:1px solid #000}
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
  toggleDone, deleteTaskById, setNavOffset, openModal, setPreviewTask, isMobile, todayKey
}) {
  const laidOut = useMemo(
    () => layoutTasks(filteredTasks, viewDays, base),
    [filteredTasks, viewDays, base]
  )

  const maxLane = laidOut.reduce((m, t) => Math.max(m, t.lane), -1)
  const LANE_H  = 26
  const GRID_H  = Math.max((maxLane + 1) * LANE_H + 8, 56)

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
                  return (
                    <div key={t.id} className={`kh-task-bar${t.done ? " done" : ""}`}
                      title={`${t.text}${t.assignee ? " ／ " + t.assignee : ""}`}
                      style={{
                        top: t.lane * LANE_H + 3,
                        left: `calc(${ls * 100 / wLen}% + ${sh ? 2 : 0}px)`,
                        width: `calc(${span * 100 / wLen}% - ${(sh ? 2 : 0) + (eh ? 2 : 0)}px)`,
                        height: LANE_H - 4,
                        background: c.bg,
                        borderRadius: `${sh ? 4 : 0}px ${eh ? 4 : 0}px ${eh ? 4 : 0}px ${sh ? 4 : 0}px`,
                        paddingLeft: sh ? 5 : 2,
                        paddingRight: eh ? 4 : 2,
                        zIndex: 10
                      }}
                      onClick={() => setPreviewTask(t)}
                      role="button"
                      tabIndex={0}
                      aria-label={`タスク: ${t.text}`}
                      onKeyDown={e => e.key === "Enter" && setPreviewTask(t)}>
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
  filteredTasks, viewDays, base, navLabel, colDates, isMobile,
  toggleDone, deleteTaskById, setNavOffset, openModal, setPreviewTask, todayKey,
  printMemos, setPrintMemos
}) {
  const canvasRef = useRef(null)
  
  // レイアウトされたタスク
  const laidOut = useMemo(
    () => layoutTasks(filteredTasks, viewDays, base),
    [filteredTasks, viewDays, base]
  )
  
  // 週ごとにグループ化
  const weeks = []
  for (let i = 0; i < viewDays; i += 7) weeks.push({ wo: i, days: colDates.slice(i, i + 7) })
  
  const addMemo = () => {
    setPrintMemos([...printMemos, {
      id: Date.now(),
      text: "メモを入力",
      x: 100,
      y: 150,
      fontSize: 14,
      fontWeight: "normal"
    }])
  }
  
  const updateMemo = (id, updates) => {
    setPrintMemos(printMemos.map(m => m.id === id ? {...m, ...updates} : m))
  }
  
  const deleteMemo = (id) => {
    setPrintMemos(printMemos.filter(m => m.id !== id))
  }
  
  const handlePrintClick = () => {
    window.print()
  }
  
  // タイトルの月を取得
  const titleMonth = colDates[0] ? `${colDates[0].getMonth() + 1}月` : ""
  
  return (
    <div className="kh-print-tab">
      <div className="kh-print-toolbar">
        <button className="kh-print-tool-btn" onClick={addMemo}>
          ➕ メモ追加
        </button>
        <button className="kh-print-tool-btn kh-print-execute" onClick={handlePrintClick}>
          🖨️ 印刷する
        </button>
        <div className="kh-print-hint">
          メモをドラッグして移動、ダブルクリックで編集
        </div>
      </div>
      <div className="kh-print-canvas" ref={canvasRef}>
        {/* 印刷用ヘッダー */}
        <div className="kh-print-page-header">
          <h1 className="kh-print-title">{titleMonth} 工程表</h1>
          <div className="kh-print-legend-bar">
            {COLORS.map(c => (
              <div key={c.id} className="kh-print-legend-item">
                <div className="kh-print-legend-dot" style={{background: c.bg}}></div>
                <span className="kh-print-legend-label">{c.label}</span>
              </div>
            ))}
          </div>
        </div>
        
        {/* カレンダーグリッド */}
        <div className="kh-print-calendar">
          {/* 曜日ヘッダー */}
          <div className="kh-print-dow-header">
            {DAYS_JA.map((d, i) => (
              <div key={i} className={`kh-print-dow-cell${i === 0 ? " sun" : i === 6 ? " sat" : ""}`}>
                {d}
              </div>
            ))}
          </div>
          
          {/* 週ごとの表示 */}
          {weeks.map(week => (
            <div key={week.wo} className="kh-print-week">
              {/* 日付とタスクを統合した行 */}
              <div className="kh-print-date-row">
                {week.days.map((d, idx) => {
                  const dk = toKey(d)
                  const isToday = dk === todayKey
                  const dow = d.getDay()
                  const dayTasks = laidOut.filter(t => {
                    const s = parseKey(t.start_key), e = parseKey(t.end_key), day = parseKey(dk)
                    return day >= s && day <= e
                  })
                  
                  return (
                    <div key={idx} className={`kh-print-date-cell${dow === 0 ? " sun" : dow === 6 ? " sat" : ""}${isToday ? " today" : ""}`}>
                      <div className="kh-print-date-num">{d.getDate()}</div>
                      <div className="kh-print-task-list">
                        {dayTasks.map(t => {
                          const s = parseKey(t.start_key)
                          const day = parseKey(dk)
                          const isFirst = day.getTime() === s.getTime()
                          const color = COLORS.find(c => c.id === t.color) || COLORS[0]
                          const [company, person] = splitAssignee(t.assignee)
                          
                          return (
                            <div
                              key={t.id}
                              className="kh-print-task-bar"
                              style={{
                                background: color.bg,
                                borderLeft: `4px solid ${color.darker}`
                              }}>
                              <div className="kh-print-task-text">
                                {isFirst && person && <div className="kh-print-task-person">{person}</div>}
                                {isFirst && <div className="kh-print-task-name">{t.text}</div>}
                                {!isFirst && <div className="kh-print-task-continue">→</div>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        
        {/* メモ */}
        {printMemos.map(memo => (
          <div
            key={memo.id}
            className="kh-print-memo"
            style={{
              left: memo.x,
              top: memo.y,
              fontSize: memo.fontSize,
              fontWeight: memo.fontWeight
            }}
            draggable
            onDragEnd={(e) => {
              const rect = canvasRef.current?.getBoundingClientRect()
              if (rect) {
                updateMemo(memo.id, {
                  x: e.clientX - rect.left - 50,
                  y: e.clientY - rect.top - 10
                })
              }
            }}
            onDoubleClick={() => {
              const newText = prompt("メモを入力:", memo.text)
              if (newText !== null) updateMemo(memo.id, {text: newText})
            }}>
            {memo.text}
            <button className="kh-print-memo-delete" onClick={() => deleteMemo(memo.id)}>×</button>
            <div className="kh-print-memo-controls">
              <button onClick={() => updateMemo(memo.id, {fontSize: memo.fontSize + 2})}>A+</button>
              <button onClick={() => updateMemo(memo.id, {fontSize: Math.max(8, memo.fontSize - 2)})}>A-</button>
              <button onClick={() => updateMemo(memo.id, {fontWeight: memo.fontWeight === "bold" ? "normal" : "bold"})}>B</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})

// ────────────────────────────────────────────────
// EditModal
// ────────────────────────────────────────────────
const EditModal = memo(function EditModal({
  editId, taskText, setTaskText, companyInput, setCompanyInput, personInput, setPersonInput,
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
          <div style={{fontSize:20,color:"#C8C3BA",paddingBottom:8}}>→</div>
          <div className="kh-date-col">
            <div className="kh-field-label">🏁 終了日</div>
            <input type="date" className="kh-date-input" value={endDate}
              min={startDate}
              onChange={e => onEndChange(e.target.value)}
              aria-label="終了日"/>
          </div>
        </div>
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
  const [startDate, setStartDate]             = useState("")
  const [endDate, setEndDate]                 = useState("")
  const [toastMsg, setToastMsg]               = useState("")
  
  // 印刷用メモの状態
  const [printMemos, setPrintMemos]           = useState([])

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
      if (editId) {
        const { error } = await supabase.from("tasks")
          .update({ text, assignee, start_key: startDate, end_key: endDate, color: selectedColor })
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
          .insert({ text, assignee, start_key: startDate, end_key: endDate, color: selectedColor, done: false })
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
  }, [taskText, companyInput, personInput, editId, startDate, endDate, selectedColor, loadTasks, showToast])

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
            onClick={() => setCurrentTab(tab.id)}
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
          setPreviewTask={setPreviewTask} todayKey={todayKey}/>
      )}
      {currentTab === "print" && (
        <PrintTab
          filteredTasks={filteredTasks} viewDays={viewDays} base={base}
          navLabel={navLabel} colDates={colDates} isMobile={isMobile}
          toggleDone={toggleDone} deleteTaskById={deleteTaskById}
          setNavOffset={setNavOffset} openModal={openModal}
          setPreviewTask={setPreviewTask} todayKey={todayKey}
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
