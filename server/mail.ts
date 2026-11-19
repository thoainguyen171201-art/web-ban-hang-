import { priceText, type SiteContent } from "../lib/site-data";
import { sql } from "./db";

type Contact=SiteContent["contact"];
type Quote={service:string;name:string;price:number|null};
export type Lead={
  id:string;name:string;phone:string;email:string;company:string;note:string;products:string[];quotes:Quote[];
  consent:boolean;created_at:string;status:string;owner_email:string;customer_email:string
};
type MailResult={status:"unconfigured"|"sent"|"failed";id:string|null};
const mailReady=()=>Boolean(process.env.RESEND_API_KEY&&process.env.RESEND_FROM_EMAIL);

async function sendMail(to:string,subject:string,content:string,key:string,replyTo?:string):Promise<MailResult> {
  if(!mailReady()||!to)return {status:"unconfigured",id:null};
  try {
    const response=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key":key},
      body:JSON.stringify({from:process.env.RESEND_FROM_EMAIL,to:[to],subject,text:content,reply_to:replyTo}),
      signal:AbortSignal.timeout(7500)
    });
    const data=await response.json();
    if(response.ok&&typeof data.id==="string"&&data.id)return {status:"sent",id:data.id};
    console.error("Resend declined",response.status);
  }catch(error) {console.error("Resend request",error instanceof Error?error.name:"Error");}
  return {status:"failed",id:null};
}

export async function deliverLead(id:string,contact:Contact) {
  const db=sql();
  const [record]=await db`UPDATE thoai_leads SET mail_claimed_at=now()
    WHERE id=${id} AND (owner_email='pending' OR customer_email='pending')
      AND (mail_claimed_at IS NULL OR mail_claimed_at < now()-interval '2 minutes')
    RETURNING id,name,phone,email,company,note,products,quotes,owner_email,customer_email`;
  if(!record)return;
  const lead=record as Lead;
  const quotes=lead.quotes.map(quote=>quote.name+" · "+priceText(quote.price));
  const common=[
    "Mã đăng ký: "+lead.id,"Giải pháp: "+lead.products.join(", "),
    ...(quotes.length?["Báo giá đã chọn: "+quotes.join("; ")]:[]),"Hotline: "+contact.hotline
  ];
  const ownerContent=[
    "Có yêu cầu tư vấn mới từ "+lead.name,...common,"Điện thoại: "+lead.phone,"Email: "+lead.email,"Đơn vị: "+(lead.company||"—"),"Nhu cầu: "+(lead.note||"—")
  ].join("\n");
  const customerContent=[
    "Chào "+lead.name+",","Viettel Đồng Nai đã ghi nhận yêu cầu tư vấn của anh/chị.",...common
  ].join("\n");
  await Promise.all([
    lead.owner_email==="pending"&&sendMail(contact.email,"Yêu cầu tư vấn mới "+id,ownerContent,"thoai-owner/"+id,lead.email)
      .then(result=>db`UPDATE thoai_leads SET owner_email=${result.status},owner_email_id=${result.id} WHERE id=${id} AND owner_email='pending'`),
    lead.customer_email==="pending"&&sendMail(lead.email,"Xác nhận đăng ký tư vấn "+id,customerContent,"thoai-customer/"+id,contact.email||undefined)
      .then(result=>db`UPDATE thoai_leads SET customer_email=${result.status},customer_email_id=${result.id} WHERE id=${id} AND customer_email='pending'`)
  ]);
}
