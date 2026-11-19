import { cookies } from "next/headers";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { contentSchemas, defaults, isPriceService, services, type ContentKey, type SiteContent } from "../../../lib/site-data";
import { pageCopyDefaults } from "../../../lib/page-copy";
import { readContent, sql } from "../../../server/db";
import { exportLeads, leadDateRange, readLeads } from "../../../server/leads";
import { body, cookieName, failure, hash, HttpError, login, sameOrigin, session } from "../../../server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 50;

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, (issue.path.length ? issue.path.join(".") + " – " : "") + issue.message);
  }
  return parsed.data;
}

async function requireSession() {
  const verified = await session();
  if (!verified) throw new HttpError(401, "Vui lòng đăng nhập.");
  return verified;
}

async function loadSection(section: ContentKey, revision: number) {
  const [record] = await sql()`SELECT data, revision FROM thoai_content WHERE section = ${section}`;
  if ((record?.revision ?? 0) !== revision) throw new HttpError(409, "Nội dung đã thay đổi ở phiên khác. Tải lại trang rồi thử lại.");
  return record?.data ?? structuredClone(defaults[section]);
}
async function saveSection(section: ContentKey, revision: number, data: unknown) {
  const db=sql();
  const [saved] = revision === 0
    ? await db`INSERT INTO thoai_content (section,data) VALUES (${section},${JSON.stringify(data)}::jsonb) ON CONFLICT DO NOTHING RETURNING data,revision`
    : await db`UPDATE thoai_content SET data = ${JSON.stringify(data)}::jsonb, revision = revision + 1
      WHERE section = ${section} AND revision = ${revision} RETURNING data, revision`;
  if (!saved) throw new HttpError(409, "Nội dung đã thay đổi ở phiên khác. Tải lại trang rồi thử lại.");
  return saved;
}

export async function GET(request: Request) {
  try {
    await requireSession();
    const filters = new URL(request.url).searchParams;
    const page = filters.get("page");
    if (page !== null) {
      const index = validate(z.coerce.number().int().min(1).max(10000), page);
      const range=leadDateRange({from:filters.get("from")??undefined,to:filters.get("to")??undefined});
      const rows=await readLeads(range,31,(index-1)*30);
      return Response.json({ rows: rows.slice(0, 30), more: rows.length > 30 });
    }
    return Response.json(await readContent());
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const action = new URL(request.url).searchParams.get("action");
    if (action === "login") {
      const input = validate(z.object({ username: z.string().max(120), password: z.string().max(200) }), await body(request, 2048));
      await login(request, input.username.trim(), input.password);
      return Response.json({ ok: true });
    }
    const token = await requireSession();
    if (action === "logout") {
      await sql()`DELETE FROM thoai_sessions WHERE token_hash = ${hash(token)}`;
      (await cookies()).delete(cookieName);
      return Response.json({ ok: true });
    }
    if (action === "export") return await exportLeads(leadDateRange(await body(request,2048)));
    if (action === "image") {
      if (!process.env.BLOB_READ_WRITE_TOKEN) throw new HttpError(503, "Chưa cấu hình Vercel Blob.");
      const options = {
        pathname: "images/" + randomUUID() + ".webp", allowedContentTypes: ["image/webp"],
        maximumSizeInBytes: 3 * 1024 * 1024, validUntil: Date.now() + 120_000
      };
      try {
        const signed = await issueSignedToken({ ...options, operations: ["put"], abortSignal: AbortSignal.timeout(8000) });
        const { presignedUrl } = await presignUrl(signed, { ...options, operation: "put", access: "public", allowOverwrite: false });
        return Response.json({ url: presignedUrl });
      } catch (error) {
        console.error("Thoại Blob sign", error instanceof Error ? error.name : "Error");
        throw new HttpError(502, "Không tạo được link tải ảnh. Vui lòng kiểm tra Blob.");
      }
    }
    throw new HttpError(404, "Không tìm thấy chức năng.");
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    await requireSession();
    const input = validate(z.object({ section: z.string(), revision: z.number().int().min(0), data: z.unknown() }), await body(request, 600_000));
    if (!Object.hasOwn(contentSchemas, input.section)) throw new HttpError(400, "Mục nội dung không hợp lệ.");
    const section = input.section as ContentKey;
    const clean = validate(contentSchemas[section] as z.ZodTypeAny, input.data);
    return Response.json(await saveSection(section, input.revision, clean));
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    await requireSession();
    const action = new URL(request.url).searchParams.get("action");
    if (action === "price-list") {
      const input = validate(z.object({
        service: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
        items: z.array(z.unknown()),
        revision: z.number().int().min(0)
      }), await body(request, 600_000));
      if (isPriceService(input.service)) {
        const current = await loadSection("prices", input.revision) as SiteContent["prices"];
        const clean = validate(contentSchemas.prices, { ...current, [input.service]: input.items });
        const saved = await saveSection("prices", input.revision, clean);
        return Response.json({ items: clean[input.service], revision: saved.revision });
      }
      const current = await loadSection("customPlans", input.revision) as SiteContent["customPlans"];
      const items = validate(contentSchemas.customPlans, input.items);
      if (items.some(item => item.serviceId !== input.service)) throw new HttpError(400, "Gói cước thuộc dịch vụ khác.");
      const clean = validate(contentSchemas.customPlans, [...current.filter(item => item.serviceId !== input.service), ...items]);
      const saved = await saveSection("customPlans", input.revision, clean);
      return Response.json({ items, revision: saved.revision });
    }
    if (action === "field") {
      const input=validate(z.object({section:z.literal("contact"),key:z.string().max(80),value:z.unknown(),revision:z.number().int().min(0)}),await body(request,16000));
      const current=await loadSection(input.section,input.revision);
      if(!Object.hasOwn(defaults[input.section],input.key))throw new HttpError(400,"Trường không hợp lệ.");
      const clean=validate(contentSchemas[input.section] as z.ZodTypeAny,{...current,[input.key]:input.value});
      const saved=await saveSection(input.section,input.revision,clean);
      return Response.json({value:clean[input.key],revision:saved.revision});
    }
    if (action === "service-image") {
      const input=validate(z.object({id:z.string().max(100),image:z.string().max(2000),revision:z.number().int().min(0)}),await body(request,4096));
      const rows=await loadSection("serviceCatalog",input.revision) as SiteContent["serviceCatalog"];
      if(!rows.some(item=>item.id===input.id))throw new HttpError(404,"Không tìm thấy dịch vụ.");
      const clean=validate(contentSchemas.serviceCatalog,rows.map(item=>item.id===input.id?{...item,image:input.image}:item));
      const saved=await saveSection("serviceCatalog",input.revision,clean);
      return Response.json({value:input.image,revision:saved.revision});
    }
    if (action === "item") {
      const input=validate(z.object({section:z.enum(["videos","serviceCatalog","customPlans","prices"]),service:z.enum(services).optional(),item:z.unknown(),revision:z.number().int().min(0)}),await body(request,40000));
      const current=await loadSection(input.section,input.revision);
      if(input.section==="prices"&&!input.service)throw new HttpError(400,"Chọn dịch vụ.");
      const schema=input.section==="prices" ? contentSchemas.prices.shape[input.service!] : contentSchemas[input.section];
      const [item]=validate(schema as z.ZodTypeAny,[input.item]);
      const rows=input.section==="prices"?current[input.service!]:current;
      const updated=rows.some((row:{id:string})=>row.id===item.id)?rows.map((row:{id:string})=>row.id===item.id?item:row):[...rows,item];
      const next=input.section==="prices"?{...current,[input.service!]:updated}:updated;
      const clean=validate(contentSchemas[input.section] as z.ZodTypeAny,next);
      const saved=await saveSection(input.section,input.revision,clean);
      return Response.json({item,revision:saved.revision});
    }
    if (action === "page-section") {
      const input=validate(z.object({page:z.string().max(80),part:z.string().max(80),data:z.record(z.string().max(8000)),revision:z.number().int().min(0)}),await body(request,200000));
      const page=Object.hasOwn(pageCopyDefaults,input.page) ? pageCopyDefaults[input.page] : undefined;
      const template=page && Object.hasOwn(page,input.part) ? page[input.part] : undefined;
      if(!template||Object.keys(input.data).length!==Object.keys(template).length||!Object.keys(template).every(key=>Object.hasOwn(input.data,key)))throw new HttpError(400,"Phần nội dung không hợp lệ.");
      const current=await loadSection("pageContent",input.revision);
      const next={...current,[input.page]:{...current[input.page],[input.part]:input.data}};
      const saved=await saveSection("pageContent",input.revision,next);
      return Response.json({data:input.data,revision:saved.revision});
    }
    const {id,status}=validate(z.object({
      id:z.string().min(1).max(150),status:z.enum(["new","contacted","closed"])
    }),await body(request,2048));
    const [lead]=await sql()`UPDATE thoai_leads SET status=${status} WHERE id=${id} RETURNING id,status`;
    if (!lead) throw new HttpError(404, "Yêu cầu không còn tồn tại.");
    return Response.json(lead);
  } catch (error) { return failure(error); }
}
