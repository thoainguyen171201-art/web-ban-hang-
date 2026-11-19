import writeExcelFile from "write-excel-file/node";
import { z } from "zod";
import { priceText } from "../lib/site-data";
import { sql } from "./db";
import { HttpError } from "./http";
import type { Lead } from "./mail";

const date = z.string().date().optional();
const dateRange = z.object({ from:date, to:date });
type DateRange = z.infer<typeof dateRange>;
const vietnamOffset = 7 * 60 * 60_000;
const day = 24 * 60 * 60_000;

export function leadDateRange(input:unknown) {
  const parsed=dateRange.safeParse(input);
  if(!parsed.success)throw new HttpError(400,"Ngày gửi không hợp lệ.");
  const {from,to}=parsed.data;
  if(from&&to&&from>to)throw new HttpError(400,"Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.");
  return parsed.data;
}

export async function readLeads({from,to}:DateRange,limit:number|null=null,offset=0) {
  const start=from ? from+"T00:00:00+07:00" : null;
  const end=to ? new Date(Date.parse(to+"T00:00:00+07:00")+day).toISOString() : null;
  return await sql()`SELECT id,name,phone,email,company,note,products,quotes,consent,status,owner_email,customer_email,created_at
    FROM thoai_leads
    WHERE (${start}::timestamptz IS NULL OR created_at >= ${start}::timestamptz)
      AND (${end}::timestamptz IS NULL OR created_at < ${end}::timestamptz)
    ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}` as Lead[];
}

const statuses:Record<string,string>={new:"Mới",contacted:"Đã liên hệ",closed:"Đã xử lý"};
const mailStatuses:Record<string,string>={sent:"Đã gửi",failed:"Gửi lỗi",pending:"Chờ gửi",unconfigured:"Chưa cấu hình email",legacy:"Không có dữ liệu cũ"};

export async function exportLeads(range:DateRange) {
  const leads=await readLeads(range);
  const headers=["Mã đăng ký","Ngày gửi (giờ VN)","Họ tên","Điện thoại","Email","Đơn vị","Dịch vụ","Gói & giá","Đồng ý","Trạng thái","Email chị Thoại","Email khách","Ghi chú"];
  const text=(value:string)=>({type:String,value:value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g,"")});
  const rows=[
    headers.map(value=>({...text(value),fontWeight:"bold" as const,backgroundColor:"#edf0f3"})),
    ...leads.map(lead=>[
      text(lead.id),{type:Date,value:new Date(Date.parse(lead.created_at)+vietnamOffset),format:"dd/mm/yyyy hh:mm:ss"},
      text(lead.name),text(lead.phone),text(lead.email),text(lead.company),text(lead.products.join(", ")),
      text(lead.quotes.map(quote=>quote.name+" · "+priceText(quote.price)).join("; ")),
      text(lead.consent?"Có":"Không"),text(statuses[lead.status]??lead.status),
      text(mailStatuses[lead.owner_email]??lead.owner_email),text(mailStatuses[lead.customer_email]??lead.customer_email),text(lead.note)
    ])
  ];
  const columns=[40,23,26,16,31,24,30,42,13,18,24,24,32].map(width=>({width}));
  const bytes=await writeExcelFile(rows,{sheet:"Yêu cầu tư vấn",columns,stickyRowsCount:1}).toBuffer();
  const suffix=range.from||range.to ? "_"+(range.from??"tat-ca")+"_"+(range.to??"tat-ca") : "";
  return new Response(new Uint8Array(bytes),{headers:{
    "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition":'attachment; filename="yeu-cau-tu-van'+suffix+'.xlsx"',
    "Cache-Control":"private, no-store"
  }});
}
