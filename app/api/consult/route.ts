import { after } from "next/server";
import { z } from "zod";
import { additionalInterests, identifier, plansFor } from "../../../lib/site-data";
import { body, failure, hash, HttpError, limit, sameOrigin } from "../../../server/http";
import { readContent, sql } from "../../../server/db";
import { deliverLead } from "../../../server/mail";

export const maxDuration=30;
const inputSchema=z.object({
  requestId:z.string().uuid(),
  name:z.string().trim().min(2).max(100), phone:z.string().trim().regex(/^\+?[\d ().-]{8,24}$/)
    .transform(value=>value.replace(/[^\d+]/g,"")).refine(value=>/^\+?\d{9,15}$/.test(value)),
  email:z.string().trim().max(200).email().transform(email=>email.toLowerCase()),
  company:z.string().trim().max(150).optional().default(""),
  needs:z.string().trim().max(2000).optional().default(""),
  products:z.array(identifier).min(1).max(100).transform(items=>[...new Set(items)].sort()),
  quotes:z.array(z.object({serviceId:identifier,planId:identifier})).max(100).default([])
    .transform(items=>items.sort((left,right)=>left.serviceId.localeCompare(right.serviceId))),
  consent:z.literal(true),website:z.literal("").optional()
});

export async function POST(request:Request) {
  try {
    sameOrigin(request);
    const parsed=inputSchema.safeParse(await body(request,16000));
    if(!parsed.success)throw new HttpError(400,"Kiểm tra họ tên, điện thoại, email, dịch vụ và ô đồng ý.");
    if(!process.env.DATABASE_URL)throw new HttpError(503,"Form tư vấn đang được thiết lập. Vui lòng liên hệ hotline.");
    const input=parsed.data, db=sql();
    const fingerprint=hash(JSON.stringify(input));
    const existing=async()=> (await db`SELECT submission_hash,products FROM thoai_leads WHERE id=${input.requestId}`)[0];
    async function confirm(record:{submission_hash:string;products:string[]}, fresh=false) {
      if(record.submission_hash!==fingerprint)throw new HttpError(409,"Yêu cầu đã được ghi nhận với thông tin khác. Hãy tải lại trang để gửi yêu cầu mới.");
      after(async()=>{
        try { await deliverLead(input.requestId,(await readContent()).data.contact); }
        catch(error){ console.error("Thoại lead delivery",(error as {code?:string})?.code??"unavailable"); }
      });
      return Response.json({id:input.requestId,products:record.products},{status:fresh?201:200});
    }
    const old=await existing();
    if(old)return confirm({submission_hash:old.submission_hash,products:old.products});
    await limit(request,"consult",15,900);
    const {data}=await readContent();
    const catalog=new Map([...data.serviceCatalog.filter(service=>service.enabled),...additionalInterests].map(service=>[service.id,service]));
    if(input.products.some(id=>!catalog.has(id)))throw new HttpError(409,"Dịch vụ đã thay đổi. Vui lòng tải lại trang.");
    if(new Set(input.quotes.map(item=>item.serviceId)).size!==input.quotes.length)throw new HttpError(400,"Chọn một gói cho mỗi dịch vụ.");
    const quotes=input.quotes.map(({serviceId,planId})=>{
      const plan=input.products.includes(serviceId)&&plansFor(data,serviceId).find(plan=>plan.enabled&&plan.id===planId);
      if(!plan)throw new HttpError(409,"Báo giá đã thay đổi. Vui lòng tải lại trang.");
      return {service:serviceId,name:plan.name,price:plan.price};
    });
    const products=input.products.map(id=>catalog.get(id)!.name);
    const [saved]=await db`INSERT INTO thoai_leads (id,submission_hash,name,phone,email,company,note,products,service_ids,consent,quotes)
      VALUES (${input.requestId},${fingerprint},${input.name},${input.phone},${input.email},${input.company},${input.needs},
        ${JSON.stringify(products)}::jsonb,${JSON.stringify(input.products)}::jsonb,true,${JSON.stringify(quotes)}::jsonb)
      ON CONFLICT DO NOTHING RETURNING submission_hash,products`;
    const result=saved??await existing();
    if(!result)throw new HttpError(503,"Chưa thể ghi nhận. Vui lòng thử lại.");
    return confirm({submission_hash:result.submission_hash,products:result.products},Boolean(saved));
  }catch(error){return failure(error);}
}
