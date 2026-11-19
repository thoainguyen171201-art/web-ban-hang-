import { z } from "zod";
import seed from "./thoai-seed.json" with { type: "json" };
import labels from "./thoai-labels.json" with { type: "json" };

export const services = ["tendoo", "ca", "contract", "invoice", "bhxh", "ftth"] as const;
export type Service = (typeof services)[number];
export function isPriceService(id: string): id is Service {
  return (services as readonly string[]).includes(id);
}
export const serviceNames = Object.fromEntries(seed.serviceCatalog.map(item => [item.id, item.name])) as Record<Service,string>;
export const groups: Record<Service, Record<string,string>> = labels.groups;
const short = z.string().trim().max(240);
const long = z.string().trim().max(8000);
const name = short.min(1, "Vui lòng nhập tên.");
export const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "Mã không hợp lệ.");
const base = { id: identifier, enabled: z.boolean() };
const lines = z.array(z.string().trim().max(600)).max(35);
export function secureUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}
const optionalUrl = z.string().trim().max(2000).refine(value => !value || secureUrl(value), "Dùng đường dẫn https.");
const image = z.string().max(2000).refine(value => !value || /^\/assets\/[\w.-]+$/.test(value) ||
  (secureUrl(value) && new URL(value).hostname.endsWith(".public.blob.vercel-storage.com") &&
  /^\/images\/[\w-]+\.webp$/.test(new URL(value).pathname)), "Vui lòng chọn ảnh hợp lệ.");
const email=z.union([z.string().trim().email().max(254),z.literal("")]);
const serviceRef = z.union([identifier, z.literal("")]).default("");
const planFields = {
  ...base, name, price: z.number().int().nonnegative().max(1_000_000_000_000).nullable(),
  vatNote: short.default(""), details: lines.default([]),
  term:short.default(""), old:z.number().int().nonnegative().max(1_000_000_000_000).nullable().default(null),
  discount:z.number().int().min(0).max(100).nullable().default(null),
  domestic:z.number().int().nonnegative().nullable().default(null),international:z.number().int().nonnegative().nullable().default(null),
  option:short.default("")
};
const plan = z.object(planFields);
const originals = (id: Service) => z.array(plan.extend({
  group: z.string().refine(group => Object.hasOwn(groups[id],group), "Chọn nhóm gói.")
})).max(400)
  .refine(uniqueIds, "Mã gói bị trùng.");

function uniqueIds(items: {id:string}[]) {
  return new Set(items.map(item => item.id)).size === items.length;
}

export function videoSource(value: string) {
  const idPattern = /^[\w-]{11}$/;
  const playlistPattern = /^[\w-]{12,100}$/;
  if (idPattern.test(value)) return { kind:"youtube", embed:"https://www.youtube.com/embed/" + value, url:"https://www.youtube.com/watch?v=" + value };
  if (/^\/assets\/[\w.-]+\.mp4$/i.test(value)) return {kind:"mp4",embed:value,url:value};
  if (!secureUrl(value)) return null;
  const url = new URL(value);
  if (url.pathname.toLowerCase().endsWith(".mp4")) return {kind:"mp4", embed:value, url:value};
  if (!["www.youtube.com","youtube.com","m.youtube.com","youtu.be","www.youtube-nocookie.com"].includes(url.hostname)) return null;
  const parts = url.pathname.split("/");
  const list = url.searchParams.get("list");
  if (list && playlistPattern.test(list)) return {kind:"youtube", embed:"https://www.youtube.com/embed/videoseries?list=" + list, url:"https://www.youtube.com/playlist?list=" + list};
  const id = url.hostname === "youtu.be" ? parts[1] : (url.searchParams.get("v") ?? parts[2] ?? "");
  return idPattern.test(id) ? {kind:"youtube", embed:"https://www.youtube.com/embed/" + id, url:"https://www.youtube.com/watch?v=" + id} : null;
}

function serviceSlug(value:string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{M}/gu,"").replace(/đ/g,"d")
    .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,90).replace(/-+$/,"");
}

const catalog = z.object({
  ...base, name, slug: z.string().trim().max(500,"Đường dẫn quá dài.").default(""), category: short.default(""),
  description: long.default(""), points: lines.default([]), official: optionalUrl.default(""), image: image.default(""),
  detailTitle: short.default(""), detailIntro: long.default(""), detailContent: long.default("")
}).transform(item=>({
  ...item, slug:serviceSlug(item.slug||item.name)||serviceSlug("dich-vu-"+item.id)
}));
const list = <T extends z.ZodType<{id:string}, z.ZodTypeDef, any>>(schema: T, max = 100) =>
  z.array(schema).max(max).refine(uniqueIds, "Mã mục bị trùng.");

export const contentSchemas = {
  contact:z.object({
    name, role:short, hotline:z.string().regex(/^\+?[\d ().-]{8,24}$/).refine(value=>value.replace(/\D/g,"").length>=8,"Kiểm tra hotline."),
    address:short, email, publicEmail:email, portrait:image, qr:image, storePhoto:image, ticker:long
  }),
  videos:list(z.object({...base,title:name,name:short.default(""),description:long.default(""),
    link:z.string().trim().max(2000).refine(value=>videoSource(value)!==null,"Link hoặc ID video không hợp lệ."),service:serviceRef})),
  pageContent:z.record(z.record(z.record(z.string().max(8000)))),
  serviceCatalog:list(catalog).refine(items=>new Set(items.map(item=>item.slug)).size===items.length,"Đường dẫn dịch vụ đã được sử dụng. Hãy nhập đường dẫn khác."),
  prices:z.object({tendoo:originals("tendoo"), ca:originals("ca"), contract:originals("contract"), invoice:originals("invoice"), bhxh:originals("bhxh"), ftth:originals("ftth")}),
  customPlans:list(plan.extend({serviceId:identifier}),400),
};
export type ContentKey = keyof typeof contentSchemas;
export type SiteContent = {[K in ContentKey]: z.infer<(typeof contentSchemas)[K]>};
export const defaults = Object.fromEntries(Object.entries(contentSchemas).map(([key,schema]) =>
  [key,schema.parse(seed[key as ContentKey])])) as SiteContent;
export function addressTicker(contact: Pick<SiteContent["contact"],"address"|"hotline">) {
  return [contact.address&&"Địa chỉ: "+contact.address, "Hotline: "+contact.hotline].filter(Boolean).join(". ");
}
export const additionalInterests=seed.additionalInterests;
export const ftthHeaders=labels.ftthHeaders;
export type CatalogItem = SiteContent["serviceCatalog"][number];
export type Plan = SiteContent["prices"][Service][number] | SiteContent["customPlans"][number];
export function catalogUrl(item: CatalogItem) {
  return isPriceService(item.id) ? "/#cards" : "/dich-vu/" + item.slug;
}
export function plansFor(data: SiteContent, id: string): Plan[] {
  return isPriceService(id) ? data.prices[id] : data.customPlans.filter(item=>item.serviceId===id);
}
export const priceText = (price:number|null) => price===null ? "Liên hệ báo giá" : new Intl.NumberFormat("vi-VN").format(price) + " ₫";
