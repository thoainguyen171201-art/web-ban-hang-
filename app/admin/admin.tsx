"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { catalogFields, contactFields, customPlanFields, listFields, priceFields, type Field } from "../../lib/admin-fields";
import { addressTicker, isPriceService, type ContentKey, type Service, type SiteContent } from "../../lib/site-data";

import { pageCopyLabels } from "../../lib/page-copy";

type Notice = { text: string; error: boolean };
type Entry = { id: string; enabled: boolean } & Record<string, unknown>;
type RecordData = Record<string, unknown>;
type AdminData = { data: SiteContent; revisions: Record<ContentKey,number> };
type Lead = {
  id:string; name:string; phone:string; email:string; company:string; note:string; products:string[];
  quotes:{service:string;name:string;price:number|null}[]; status:string; owner_email:string;customer_email:string;created_at:string;
};
const tabs = { contact:"Liên hệ", page:"Trang chủ", serviceCatalog:"Dịch vụ", prices:"Báo giá", videos:"Video", leads:"Yêu cầu tư vấn" } as const;
type Tab = keyof typeof tabs;
const leadStatus: Record<string,string> = { new:"Mới", contacted:"Đã liên hệ", closed:"Đã xử lý" };
const mailStatus: Record<string,string> = { pending:"Đang gửi",sent:"Đã gửi",failed:"Gửi lỗi",unconfigured:"Chưa cấu hình email",skipped:"Không có email",legacy:"Không có dữ liệu cũ" };

async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch("/api/admin" + path, {
    method, cache:"no-store", signal:AbortSignal.timeout(25_000),
    ...(data !== undefined ? { headers:{"Content-Type":"application/json"}, body:JSON.stringify(data) } : {})
  });
  const result = await response.json().catch(()=>({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "?action=login") location.reload();
    throw new Error(result.error || "Không kết nối được máy chủ.");
  }
  return result as T;
}
const message = (error:unknown) => error instanceof Error && error.name !== "TimeoutError" ? error.message : "Kết nối quá lâu. Vui lòng thử lại.";
const formatPrice = (value:number|null) => value === null ? "Liên hệ báo giá" : new Intl.NumberFormat("vi-VN").format(value) + "đ";

function fresh(fields:Field[]):Entry {
  const entry:Entry = { id:crypto.randomUUID(), enabled:true };
  for (const field of fields) {
    if (field.optional && field.kind !== "image") continue;
    entry[field.key] = field.nullable ? null : field.kind === "number" ? 0 : field.kind === "check" ? false
      : field.kind === "select" ? field.options?.[0]?.[0] : field.kind === "lines" ? [] : "";
  }
  return entry;
}
function labelOf(item:Entry) { return String(item.name || item.title || item.q || "Mục mới"); }

async function encode(file: File): Promise<Blob> {
  if (file.size > 10_000_000) throw new Error("File ảnh tối đa 10 MB.");
  if (!["image/png","image/jpeg","image/webp"].includes(file.type)) throw new Error("Vui lòng chọn ảnh JPG, PNG hoặc WebP.");
  const bitmap = await createImageBitmap(file).catch(()=> { throw new Error("Không đọc được ảnh."); });
  try {
    if (bitmap.width * bitmap.height > 24_000_000) throw new Error("Ảnh tối đa 24 megapixel.");
    const scale = Math.min(1,1600/bitmap.width,2400/bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext("2d")!.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const output = (quality:number) => new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/webp",quality));
    let blob = await output(.9);
    if (blob && blob.size > 3*1024*1024) blob = await output(.8);
    if (!blob || blob.type !== "image/webp" || blob.size > 3*1024*1024) throw new Error("Không tạo được ảnh WebP đủ nhỏ.");
    return blob;
  } finally { bitmap.close(); }
}

function ImageField({ label, value, optional, change, report, lock, publish, canPublish }: {
  label:string;value:string;optional?:boolean;change:(value:string)=>void;report:(text:string,error?:boolean)=>void;lock:(pending:boolean)=>void;
  publish?:()=>void;canPublish?:boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [uploading,setUploading] = useState(false);
  async function upload() {
    const selected = file.current?.files?.[0];
    if (!selected || uploading) return;
    setUploading(true); lock(true);
    try {
      report("Đang chuẩn bị ảnh…");
      const bytes = await encode(selected);
      const {url} = await api<{url:string}>("?action=image","POST",{});
      report("Đang tải ảnh lên Blob…");
      const response = await fetch(url,{method:"PUT",headers:{"x-vercel-blob-access":"public"},body:bytes,
        credentials:"omit",referrerPolicy:"no-referrer",signal:AbortSignal.timeout(40_000)});
      const result = await response.json().catch(()=>({}));
      if (!response.ok || typeof result.url !== "string") throw new Error("Tải ảnh lên Blob thất bại.");
      change(result.url);
      report("Đã tải ảnh. Bấm lưu để xuất bản.");
    } catch (error) { report(message(error),true); }
    finally { if (file.current) file.current.value = ""; setUploading(false); lock(false); }
  }
  return <div className="vui-field vui-image">
    <strong>{label}</strong>
    {value && <img src={value} alt={"Xem trước " + label} loading="lazy"/>}
    <div className="vui-actions">
      <input type="file" aria-label={"Chọn file " + label} accept="image/png,image/jpeg,image/webp" ref={file}
        onChange={upload} disabled={uploading}/>
      {optional && value && <button type="button" className="vui-secondary" onClick={()=>change("")} disabled={uploading}>Bỏ ảnh</button>}
      {publish && <button type="button" onClick={publish} disabled={uploading || !canPublish} aria-label={"Lưu "+label}>Lưu ảnh này</button>}
    </div>
    <small>JPG, PNG, WebP · Tối đa 10 MB</small>
  </div>;
}

function Fields({ fields, record, change, report, lock, publishField, fieldChanged, publishImage, imageChanged }: {
  fields:Field[];record:RecordData;change:(key:string,value:unknown)=>void;report:(text:string,error?:boolean)=>void;lock:(pending:boolean)=>void;
  publishField?:(key:string)=>void;fieldChanged?:(key:string)=>boolean;publishImage?:()=>void;imageChanged?:boolean;
}) {
  return <div className="vui-fields">{fields.map(field => {
    const value = record[field.key];
    if (field.kind === "image") return <ImageField key={field.key} label={field.label} value={String(value ?? "")}
      optional={field.optional} change={value=>change(field.key,value)} report={report} lock={lock}
      publish={publishField?()=>publishField(field.key):publishImage} canPublish={fieldChanged?.(field.key)??imageChanged}/>;
    if (field.kind === "check") return <div key={field.key}><label className="vui-check"><input type="checkbox" aria-label={field.label} checked={Boolean(value)} onChange={e=>change(field.key,e.target.checked)}/>{field.label}</label>{publishField&&<button type="button" onClick={()=>publishField(field.key)} disabled={!fieldChanged?.(field.key)} aria-label={"Lưu "+field.label}>Lưu phần này</button>}</div>;
    const set = (input:string) => {
      if (field.kind === "lines") change(field.key,input.split("\n"));
      else if (field.kind === "number") change(field.key,input === "" ? field.nullable ? null : undefined : Number(input));
      else change(field.key,input === "" && field.optional ? undefined : input);
    };
    return <label key={field.key} className={"vui-field" + (field.kind === "lines" || field.kind === "area" ? " vui-wide" : "")}>
      {field.label}
      {field.kind === "select" ? <select aria-label={field.label} value={String(value ?? "")} onChange={e=>set(e.target.value)}>
        {field.optional && <option value="">—</option>}{field.options?.map(([key,text])=><option key={key} value={key}>{text}</option>)}
      </select> : field.kind === "area" || field.kind === "lines" ? <textarea aria-label={field.label} rows={4}
        value={Array.isArray(value) ? value.join("\n") : String(value ?? "")} onChange={e=>set(e.target.value)}/>
      : <input aria-label={field.label} type={field.kind === "number" ? "number" : (field.key === "email" || field.key === "publicEmail") ? "email" : "text"} min={field.kind === "number" ? 0 : undefined}
        value={String(value ?? "")} onChange={e=>set(e.target.value)}/>}
      {publishField&&<button type="button" onClick={()=>publishField(field.key)} disabled={!fieldChanged?.(field.key)} aria-label={"Lưu "+field.label}>Lưu phần này</button>}
    </label>;
  })}</div>;
}

function ListEditor({ items, fields, set, report, lock, publishItem, itemChanged, editFields, publishImage, imageChanged, canDelete }: {
  items:Entry[];fields:Field[];set:(items:Entry[])=>void;report:(text:string,error?:boolean)=>void;lock:(pending:boolean)=>void;
  publishItem?:(item:Entry)=>void;itemChanged?:(item:Entry)=>boolean;editFields?:(item:Entry)=>Field[];
  publishImage?:(item:Entry)=>void;imageChanged?:(item:Entry)=>boolean;canDelete?:(item:Entry)=>boolean;
}) {
  const [editing,setEditing] = useState("");
  const item = items.find(entry=>entry.id === editing);
  function change(id:string,key:string,value:unknown) {
    set(items.map(entry=>entry.id===id ? {...entry,[key]:value}:entry));
  }
  function move(index:number, delta:number) {
    const copy=[...items];
    [copy[index],copy[index+delta]]=[copy[index+delta],copy[index]];
    set(copy);
  }
  return <>
    <button type="button" onClick={()=>{const row=fresh(fields);set([...items,row]);setEditing(row.id);}}>Thêm mới</button>
    {item && <section className="vui-row-editor" aria-label="Chỉnh sửa mục">
      <div className="vui-toolbar"><h2>{labelOf(item)}</h2><button className="vui-secondary" type="button" onClick={()=>setEditing("")}>Thu gọn</button></div>
      <Fields key={item.id} fields={editFields?editFields(item):fields} record={item} change={(key,value)=>change(item.id,key,value)} report={report} lock={lock}
        publishImage={publishImage?()=>publishImage(item):undefined} imageChanged={imageChanged?.(item)}/>
      {publishItem && <button type="button" onClick={()=>publishItem(item)} disabled={!itemChanged?.(item)}>Lưu mục này</button>}
    </section>}
    {!items.length && <p>Chưa có mục nào.</p>}
    <ul className="vui-list">{items.map((entry,index)=><li key={entry.id}>
      <strong>{labelOf(entry)}</strong>
      <div className="vui-actions">
        <label className="vui-check"><input type="checkbox" checked={entry.enabled} onChange={e=>change(entry.id,"enabled",e.target.checked)}/>Hiển thị</label>
        <button type="button" className="vui-secondary" onClick={()=>setEditing(entry.id)}>Sửa</button>
        <button type="button" className="vui-secondary" disabled={index===0} onClick={()=>move(index,-1)} aria-label={"Đưa lên "+labelOf(entry)}>↑</button>
        <button type="button" className="vui-secondary" disabled={index===items.length-1} onClick={()=>move(index,1)} aria-label={"Đưa xuống "+labelOf(entry)}>↓</button>
        {(!canDelete||canDelete(entry))&&<button type="button" className="vui-secondary vui-danger" onClick={()=>{
          if (confirm("Xóa “"+labelOf(entry)+"” khi lưu và xuất bản?")) {
            set(items.filter(value=>value.id!==entry.id));
            report("Đã đánh dấu xóa. Bấm lưu để xuất bản.");
          }
        }} aria-label={"Xóa "+labelOf(entry)}>Xóa</button>}
      </div>
    </li>)}</ul>
  </>;
}

function Leads({ report }: { report:(text:string,error?:boolean)=>void }) {
  const [page,setPage] = useState(1), [rows,setRows] = useState<Lead[]>([]), [more,setMore] = useState(false);
  const [exporting,setExporting]=useState(false);
  const [from,setFrom]=useState(""), [to,setTo]=useState("");
  const [loading,setLoading] = useState(true), [version,refresh] = useState(0), [saving,setSaving] = useState("");
  const invalidRange=Boolean(from&&to&&from>to);
  const filters=new URLSearchParams();
  if(from)filters.set("from",from);
  if(to)filters.set("to",to);
  const query=filters.toString();

  useEffect(()=>{
    if(invalidRange){setLoading(false);return;}
    let active=true;
    setLoading(true);
    api<{rows:Lead[];more:boolean}>("?page="+page+(query?"&"+query:"")).then(result=>{
      if (active) {setRows(result.rows);setMore(result.more);}
    }).catch(error=>{if(active)report(message(error),true);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[page,version,query,invalidRange,report]);

  async function downloadExcel() {
    setExporting(true);
    try{
      const response=await fetch("/api/admin?action=export",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(Object.fromEntries(filters)),signal:AbortSignal.timeout(50_000)
      });
      if(!response.ok){
        const result=await response.json().catch(()=>({}));
        if(response.status===401)location.reload();
        throw new Error(result.error||"Xuất file Excel thất bại.");
      }
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement("a");
      link.href=url;
      link.download=response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]??"yeu-cau-tu-van.xlsx";
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      report("Đã tải file Excel.");
    }catch(error){report(message(error),true);}finally{setExporting(false);}
  }

  return <>
    <div className="vui-lead-filters" role="group" aria-label="Lọc theo ngày gửi">
      <label className="vui-field">Từ ngày<input type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(1);}}/></label>
      <label className="vui-field">Đến ngày<input type="date" value={to} onChange={event=>{setTo(event.target.value);setPage(1);}}/></label>
      <button type="button" className="vui-secondary" disabled={!from&&!to} onClick={()=>{setFrom("");setTo("");setPage(1);}}>Xóa lọc</button>
      <button type="button" disabled={exporting||invalidRange} onClick={downloadExcel}>{exporting?"Đang xuất…":"Xuất Excel"}</button>
    </div>
    <div className="vui-toolbar">
      <span>Trang {page}</span><div className="vui-actions">
        <button type="button" className="vui-secondary" onClick={()=>setPage(page-1)} disabled={loading || invalidRange || page===1}>Trang trước</button>
        <button type="button" className="vui-secondary" onClick={()=>setPage(page+1)} disabled={loading || invalidRange || !more}>Trang sau</button>
        <button type="button" className="vui-secondary" onClick={()=>refresh(version+1)} disabled={loading}>Làm mới</button>
      </div>
    </div>
    {invalidRange ? <p role="alert">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p> : loading ? <p>Đang tải yêu cầu…</p> : !rows.length ? <p>{query?"Không có yêu cầu trong khoảng ngày đã chọn.":"Chưa có yêu cầu tư vấn."}</p> : <ul className="vui-leads">{rows.map(lead=><li key={lead.id}>
      <div><strong>{lead.name}</strong><p><a href={"tel:"+lead.phone}>{lead.phone}</a>{lead.email && <> · <a href={"mailto:"+lead.email}>{lead.email}</a></>}</p>
      {lead.company && <p>{lead.company}</p>}<small>Mã {lead.id}<br/>{new Date(lead.created_at).toLocaleString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"})}</small></div>
      <div><p>{lead.products.join(", ")}</p>{lead.quotes.map(quote=><p key={quote.service}>{quote.name} · {formatPrice(quote.price)}</p>)}{lead.note && <p>{lead.note}</p>}
      <small>Email chuyên viên: {mailStatus[lead.owner_email]} · Email khách: {mailStatus[lead.customer_email]}</small></div>
      <div><label>Trạng thái<select disabled={Boolean(saving)} value={lead.status} onChange={async event=>{
        const status=event.target.value;setSaving(lead.id);
        try {await api("","PATCH",{id:lead.id,status});setRows(rows=>rows.map(item=>item.id===lead.id ? {...item,status}:item));report("Đã cập nhật trạng thái.");}
        catch(error){report(message(error),true);}finally{setSaving("");}
      }}>{Object.entries(leadStatus).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label>
      </div>
    </li>)}</ul>}
  </>;
}

type PatchResult = { revision:number;item?:Entry;items?:Entry[];value?:unknown;data?:Record<string,string> };
type ListSection = "videos"|"prices"|"customPlans"|"serviceCatalog";

export function Admin({ authenticated, configured }: {authenticated:boolean;configured:boolean}) {
  const [tab,setTab] = useState<Tab>("contact"), [service,setService] = useState("tendoo");
  const [state,setState] = useState<AdminData|null>(null), [busy,setBusy] = useState(false), [uploading,setUploading] = useState(false);
  const published = useRef<SiteContent|null>(null);
  const [notice,setNotice] = useState<Notice|null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const report = useRef((text:string,error=false)=>{
    if (timer.current) clearTimeout(timer.current);
    setNotice({text,error});timer.current=setTimeout(()=>setNotice(null),10_000);
  }).current;
  const [dirty,setDirty] = useState<Set<ContentKey>>(new Set());
  const chosenService = state?.data.serviceCatalog.find(item=>item.id===service) ?? state?.data.serviceCatalog[0];
  const serviceId = chosenService?.id ?? service;
  const section:ContentKey|null = tab === "page" ? "pageContent"
    : tab === "leads" ? null : tab === "prices" && !isPriceService(serviceId) ? "customPlans" : tab;
  const [part,setPart]=useState("");
  const page="index";
  const partId = Object.hasOwn(pageCopyLabels[page].sections,part) ? part : Object.keys(pageCopyLabels[page].sections)[0];

  useEffect(()=>{
    if (authenticated) api<AdminData>("").then(result=>{published.current=structuredClone(result.data);setState(result);}).catch(error=>report(message(error),true));
    return ()=>{if(timer.current)clearTimeout(timer.current);};
  },[authenticated,report]);
  useEffect(()=>{
    if (!dirty.size) return;
    const warn=(event:BeforeUnloadEvent)=>event.preventDefault();
    window.addEventListener("beforeunload",warn);
    return ()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);

  function change(key:ContentKey,value:unknown) {
    setState(current=>current && ({...current,data:{...current.data,[key]:value}}));
    setDirty(keys=>new Set(keys).add(key));
  }
  function setDirtyState(key:ContentKey,next:unknown) {
    const pending=JSON.stringify(next)!==JSON.stringify(published.current?.[key]);
    setDirty(keys=>{const updated=new Set(keys);if(pending)updated.add(key);else updated.delete(key);return updated;});
  }
  async function partial<K extends ContentKey>(key:K,action:string,payload:RecordData,apply:(data:SiteContent[K],result:PatchResult)=>SiteContent[K]) {
    if(!state||!published.current||busy||uploading)return;
    setBusy(true);report("Đang lưu phần nội dung…");
    try {
      const saved=await api<PatchResult>("?action="+action,"PATCH",{...payload,revision:state.revisions[key]});
      published.current[key]=apply(published.current[key],saved);
      const next=apply(state.data[key],saved);
      setState(current=>current && ({data:{...current.data,[key]:next},revisions:{...current.revisions,[key]:saved.revision}}));
      setDirtyState(key,next);report("Đã lưu phần này và xuất bản.");
    }catch(error){report(message(error),true);}finally{setBusy(false);}
  }
  async function save(event:FormEvent) {
    event.preventDefault();
    if(!section||!state||busy||uploading)return;
    if (section === "prices") {
      return partial(section, "price-list", { service: serviceId, items: rows(state.data, section) },
        (data, saved) => ({ ...data, [serviceId]: saved.items }));
    }
    if (section === "customPlans") {
      return partial(section, "price-list", { service: serviceId, items: rows(state.data, section) },
        (data, saved) => [...data.filter(item => item.serviceId !== serviceId), ...saved.items as SiteContent["customPlans"]]);
    }
    setBusy(true);
    try{
      const saved=await api<{data:unknown;revision:number}>("","PUT",{section,data:state.data[section],revision:state.revisions[section]});
      if(published.current)Object.assign(published.current,{[section]:saved.data});
      setState(current=>current&&({data:{...current.data,[section]:saved.data},revisions:{...current.revisions,[section]:saved.revision}}));
      setDirty(keys=>{const next=new Set(keys);next.delete(section);return next;});report("Đã lưu danh sách và xuất bản.");
    }catch(error){report(message(error),true);}finally{setBusy(false);}
  }
  function saveField(key:string){
    if(!state||section!=="contact")return;
    const value=(state.data[section] as RecordData)[key];
    return partial(section,"field",{section,key,value},(data,saved)=>({...data,[key]:saved.value}));
  }
  function rows(data:SiteContent,key:ListSection):Entry[]{
    if(key==="prices")return data.prices[serviceId as Service] as Entry[];
    if(key==="customPlans")return data.customPlans.filter(item=>item.serviceId===serviceId) as Entry[];
    return data[key] as Entry[];
  }
  function replaceRow(items:Entry[],item:Entry){
    return items.some(row=>row.id===item.id)?items.map(row=>row.id===item.id?item:row):[...items,item];
  }
  function saveItem(key:ListSection,item:Entry){
    const record=key==="customPlans"?{...item,serviceId}:item;
    return partial(key,"item",{section:key,item:record,...(key==="prices"?{service:serviceId}:{})},(data,saved)=>{
      if(key==="prices"){
        const prices=data as SiteContent["prices"];
        return {...prices,[serviceId]:replaceRow(prices[serviceId as Service] as Entry[],saved.item!)} as typeof data;
      }
      return replaceRow(data as Entry[],saved.item!) as typeof data;
    });
  }
  function saveServiceImage(item:Entry) {
    return partial("serviceCatalog","service-image",{id:item.id,image:item.image},
      (data,saved)=>data.map(row=>row.id===item.id?{...row,image:saved.value as string}:row));
  }
  function setRows(key:ListSection,items:Entry[]){
    if(!state)return;
    if(key==="prices")return change(key,{...state.data.prices,[serviceId]:items});
    if(key==="customPlans")return change(key,[...state.data.customPlans.filter(item=>item.serviceId!==serviceId),...items.map(item=>({...item,serviceId}))]);
    change(key,items);
  }
  async function signIn(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);
    try{await api("?action=login","POST",Object.fromEntries(new FormData(event.currentTarget)));location.reload();}
    catch(error){report(message(error),true);setBusy(false);}
  }
  async function logout(){
    if(dirty.size&&!confirm("Đăng xuất và bỏ thay đổi chưa lưu?"))return;
    try{await api("?action=logout","POST",{});setDirty(new Set());setTimeout(()=>location.reload(),0);}
    catch(error){report(message(error),true);}
  }
  const toast=<p className={"vui-toast"+(notice?.error?" vui-toast-error":"")} role="status">{notice?.text}</p>;
  if(!authenticated)return <main className="vui-admin vui-login"><form className="vui-panel" method="post" onSubmit={signIn}>
    <a href="/">← Trang khách</a><h1>Đăng nhập quản trị</h1>{!configured?<p>Chưa cấu hình Neon và tài khoản quản trị. Xem README để thiết lập.</p>:<>
      <label className="vui-field">Tài khoản<input name="username" autoComplete="username" required maxLength={120}/></label>
      <label className="vui-field">Mật khẩu<input name="password" type="password" autoComplete="current-password" required maxLength={200}/></label>
      <button disabled={busy}>{busy?"Đang đăng nhập…":"Đăng nhập"}</button>
    </>}</form>{toast}</main>;

  let editor:React.ReactNode;
  const listSection=section&&["prices","customPlans","serviceCatalog",...Object.keys(listFields)].includes(section)?section as ListSection:null;
  const listDirty=Boolean(listSection&&state&&published.current&&JSON.stringify(rows(state.data,listSection))!==JSON.stringify(rows(published.current,listSection)));
  if(section&&state){
    if(section==="pageContent"){
      const metadata=pageCopyLabels[page].sections[partId];
      const record=state.data.pageContent[page][partId];
      const changed=JSON.stringify(record)!==JSON.stringify(published.current?.pageContent[page][partId]);
      editor=<>
        <label className="vui-field vui-picker">Phần nội dung<select aria-label="Phần nội dung" value={partId} onChange={e=>setPart(e.target.value)}>
          {Object.entries(pageCopyLabels[page].sections).map(([key,item])=><option key={key} value={key}>{item.label}</option>)}
        </select></label>
        <Fields fields={Object.entries(metadata.fields).map(([key,label])=>({key,label,kind:record[key].length>100?"area":"text"}))}
          record={record} change={(key,value)=>change("pageContent",{...state.data.pageContent,[page]:{...state.data.pageContent[page],[partId]:{...record,[key]:value}}})}
          report={report} lock={setUploading}/>
        <button type="button" disabled={!changed} onClick={()=>partial("pageContent","page-section",{page,part:partId,data:record},
          (data,saved)=>({...data,[page]:{...data[page],[partId]:saved.data!}}))}>Lưu phần nội dung này</button>
      </>;
    }else if(listSection){
      let fields=listSection==="prices"?priceFields[serviceId as Service]:listSection==="customPlans"?customPlanFields:listSection==="serviceCatalog"?catalogFields:listFields[listSection];
      const options=state.data.serviceCatalog.map(item=>[item.id,item.name] as const);
      fields=fields.map(field=>field.key==="service"?{...field,options:[["","Nội dung chung"],...options]}:field);
      editor=tab==="prices"&&!chosenService?<p>Thêm dịch vụ trước khi quản lý gói cước.</p>:<ListEditor key={section+serviceId}
        items={rows(state.data,listSection)} fields={fields} set={items=>setRows(listSection,items)} report={report} lock={setUploading}
        publishItem={item=>saveItem(listSection,item)}
        itemChanged={item=>JSON.stringify(item)!==JSON.stringify(published.current&&rows(published.current,listSection).find(row=>row.id===item.id))}
        publishImage={listSection==="serviceCatalog"?saveServiceImage:undefined}
        imageChanged={item=>Boolean(published.current?.serviceCatalog.some(row=>row.id===item.id&&row.image!==item.image))}
        canDelete={listSection==="serviceCatalog"?item=>!isPriceService(item.id):undefined}
        editFields={listSection==="serviceCatalog"?item=>isPriceService(item.id)?fields.filter(field=>!["slug","official","detailIntro","detailContent"].includes(field.key)):fields:undefined}/>;
    }else{
      const record=state.data[section] as RecordData;
      editor=<><Fields fields={contactFields} record={record}
        change={(key,value)=>change(section,{...record,[key]:value===undefined&&(key==="email"||key==="publicEmail")?"":value})}
        report={report} lock={setUploading} publishField={saveField}
        fieldChanged={key=>JSON.stringify(record[key])!==JSON.stringify((published.current?.[section] as RecordData)?.[key])}/>
        {section==="contact" && <div className="vui-field">
          <strong>Dòng chữ chạy địa chỉ và hotline</strong>
          <span>{addressTicker(state.data.contact)}</span>
          <small>Nội dung lấy từ hai ô Địa chỉ và Hotline.</small>
        </div>}
      </>;
    }
  }
  return <main className="vui-admin">
    <header className="vui-header"><div><strong>Viettel Đồng Nai</strong><span>Quản trị · Nguyễn Thị Hồng Thoại</span></div><div className="vui-actions">
      <a href="/" target="_blank" rel="noopener">Xem trang khách ↗</a><button type="button" className="vui-secondary" disabled={busy||uploading} onClick={logout}>Đăng xuất</button>
    </div></header>
    <div className="vui-layout"><nav aria-label="Mục quản trị">{Object.entries(tabs).map(([key,text])=><button key={key} type="button" className="vui-nav"
      aria-current={tab===key?"page":undefined} disabled={busy||uploading} onClick={()=>setTab(key as Tab)}>{text}</button>)}</nav>
      <div className="vui-main"><h1>{tabs[tab]}</h1>{tab==="leads"?<section className="vui-panel"><Leads report={report}/></section>:state&&section?<form className="vui-panel" onSubmit={save}>
        <fieldset className="vui-editor" disabled={busy||uploading}>
          {tab==="prices"&&<label className="vui-field vui-picker">Dịch vụ<select aria-label="Dịch vụ" value={serviceId} onChange={e=>setService(e.target.value)}>{state.data.serviceCatalog.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {section==="serviceCatalog"&&<p>Thêm dịch vụ mới để có trang chi tiết tại /dich-vu/đường-dẫn. Các thẻ dịch vụ hiện có được sửa tại đây.</p>}
          {editor}
          {listSection&&<div className="vui-save"><button type="submit" disabled={busy||uploading||!listDirty}>{busy?"Đang lưu…":"Lưu danh sách"}</button>{listDirty&&<small>Có thay đổi chưa xuất bản</small>}</div>}
        </fieldset>
      </form>:<p>Đang tải nội dung…</p>}</div>
    </div>{toast}
  </main>;
}
