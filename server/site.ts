import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import type { AnyNode } from "domhandler";
import { additionalInterests, addressTicker, catalogUrl, defaults, ftthHeaders, groups, isPriceService, plansFor, priceText, services, videoSource,
  type CatalogItem, type Plan, type Service, type SiteContent } from "../lib/site-data";
import { readContent } from "./db";

let template:Promise<string>|undefined;
type Document=ReturnType<typeof load>;
const pricing = {
  tendoo: ["#tendooPricing","#tdGrid"],
  ca: ["#caPricing",".ca-price-grid"],
  contract: ["#vcontractPricing",".vc-grid"],
  invoice: ["#sinvoicePricing",".si-grid"],
  bhxh: ["#bhxhPricing",".bh-grid"],
  ftth: ["#ftthPricing",".ftth-price-tables"]
} as const;

function applyCopy($:Document, copy:SiteContent["pageContent"][string]) {
  const value=(key:string)=>{const [part,field]=key.split("/");return copy[part]?.[field];};
  function walk(nodes:AnyNode[]) {
    for(const node of nodes) {
      if(node.type==="comment"&&node.data.startsWith("thoai-copy:")&&node.next?.type==="text") {
        const replacement=value(node.data.slice("thoai-copy:".length));
        if(replacement!==undefined&&node.next.data.replace(/\s+/g," ").trim()!==replacement) {
          node.next.data=(node.next.data.match(/^\s*/)?.[0]??"")+replacement+(node.next.data.match(/\s*$/)?.[0]??"");
        }
      }
      if("children" in node)walk(node.children);
    }
  }
  walk($("body").contents().get());
  $("[data-thoai-placeholder]").each((_,node)=>{
    const element=$(node), replacement=value(element.attr("data-thoai-placeholder")!);
    if(replacement!==undefined)element.attr("placeholder",replacement);
  });
}

function applyContact($:Document, contact:SiteContent["contact"]) {
  const normalize=(text:string)=>text
    .replace(/Nguyễn Thị Hồng Thoại|Hồng Thoại/g,match=>contact.name===defaults.contact.name?match:contact.name)
    .replace(/0374[ .]?477[ .]?921/g,()=>contact.hotline)
    .replace(/Chuyên viên tư vấn giải pháp số cho doanh nghiệp/g,()=>contact.role);
  function walk(nodes:AnyNode[]) {
    for(const node of nodes) {
      if(node.type==="text")node.data=normalize(node.data);
      else if(node.type!=="style"&&node.type!=="script"&&"children" in node)walk(node.children);
    }
  }
  walk($("body").contents().get());
  $("a[href^='tel:']").attr("href","tel:"+contact.hotline.replace(/[^\d+]/g,""))
    .each((_,element)=>{const link=$(element),caption=link.attr("aria-label");if(caption)link.attr("aria-label",normalize(caption));});
  const email=$(".viettel-contact-footer a[href^='mailto:']");
  if(contact.publicEmail) email.attr("href","mailto:"+contact.publicEmail).find("strong").text(contact.publicEmail);
  else email.parent().remove();
  const address=$(".viettel-contact-footer p").last();
  if(contact.address)address.find("strong").text("Địa chỉ: "+contact.address);
  else address.remove();
  if(contact.role!==defaults.contact.role) $(".portrait-role").text(contact.role).append("<br>Viettel Đồng Nai");
  $(".portrait > img").attr({src:contact.portrait,alt:contact.name+" tại văn phòng Viettel"});
  $(".contact-store-photo").attr({src:contact.storePhoto,alt:contact.name+" tại cửa hàng Viettel"});
  $(".register-qr").attr({src:contact.qr,alt:"Mã QR TAMMI của "+contact.name});
  $(".ticker-track strong").text(["VIETTEL ĐỒNG NAI",addressTicker(contact),contact.ticker].filter(Boolean).join(". "));
}

function quoteButton($:Document, plan:Plan, className:string="") {
  return $("<button type='button'>").addClass(className).attr("data-plan-id",plan.id).text("Mua gói");
}
function renderFtth($:Document, plans:Plan[]) {
  const target=$(".ftth-price-tables");
  for(const [i,group] of ["static","dynamic"].entries()) {
    const list=plans.filter(plan=>"group" in plan&&plan.group===group);
    if(!list.length)continue;
    const meta=ftthHeaders[i];
    const labels=["Gói cước","Trong nước tối đa","Quốc tế tối thiểu",meta.option,"Giá cước (Đã bao gồm VAT)","Mua gói"];
    const section=$("<section class='ftth-price-section'>").append($("<h3>").text(meta.heading));
    const scroll=$("<div class='ftth-table-scroll' role='region'>").attr("aria-label",meta.heading);
    const table=$("<table>").attr("aria-label",meta.heading);
    const headings=$("<tr>");
    labels.forEach(label=>headings.append($("<th scope='col'>").text(label)));
    table.append($("<thead>").append(headings));
    const body=$("<tbody>");
    for(const plan of list) {
      const row=$("<tr>").append($("<th scope='row'>").text(plan.name));
      const values=[plan.domestic===null?"—":plan.domestic+" Mbps",plan.international===null?"—":plan.international+" Mbps",plan.option||"—",priceText(plan.price)];
      values.forEach((value,index)=>row.append($("<td>").toggleClass("ftth-rate",index===3)
        .append($("<span class='ftth-mobile-label' aria-hidden='true'>").text(labels[index+1]))
        .append($("<span>").text(value))));
      if(plan.details.length)row.find("th").append($("<small class='thoai-ftth-details'>").text(plan.details.filter(Boolean).join(" · ")));
      const amount=row.children("td").last();
      if(plan.vatNote)amount.append($("<small class='thoai-ftth-details'>").text(plan.vatNote));
      if(plan.term)amount.append($("<small class='thoai-ftth-details'>").text(plan.term));
      row.append($("<td>").append(quoteButton($,plan)));
      body.append(row);
    }
    section.append(scroll.append(table.append(body)));
    if(meta.caption)section.append($("<p class='ftth-offer'>").text(meta.caption));
    target.append(section);
  }
}

function planDetail(text:string,plan:Plan,service:string) {
  if(text.startsWith("Thời gian sử dụng:"))return "Thời gian sử dụng: "+(plan.term||"Liên hệ");
  if(service==="invoice"&&/^(Giá gói cước|Tổng giá gói):/.test(text))return text.split(":")[0]+": "+priceText(plan.price);
  if(service==="invoice"&&/^Chữ ký số [0-9]+ tháng$/.test(text))return plan.term.startsWith("Chữ ký số ")?plan.term:"Chữ ký số "+(plan.term||"Liên hệ");
  if(service==="ca"&&text.startsWith("Loại đăng ký:"))return "Loại đăng ký: "+("group" in plan&&plan.group==="renew"?"Gia hạn":"Đăng ký mới");
  return text;
}

function renderPricing($:Document, service:Service, plans:Plan[]) {
  const [selector,grid]=pricing[service];
  const dialog=$(selector), target=dialog.find(grid);
  dialog.attr("data-price-service",service);
  dialog.find(".pricing-close-square").first().attr("data-close","");
  if(service==="ftth")renderFtth($,plans);
  else for(const [i,plan] of plans.entries()) {
    const group="group" in plan?plan.group:"";
    const card=$("<article>").attr("data-group",group).append($("<h3>").text(plan.name));
    if(service==="tendoo"){
      card.addClass("td-price-card");
      const duration=$("<p class='td-duration'>").append($("<span>").text("Thời gian sử dụng"),$("<b>").text(plan.term||"—"));
      const price=$("<div class='td-total'>").append($("<div>").append($("<b>").text("Tổng tiền:"),$("<strong>").text(priceText(plan.price))),$("<small>").text(plan.vatNote));
      card.append(duration,price);
      if(plan.details.length)card.append($("<p>").text(plan.details.join(" · ")));
      card.append(quoteButton($,plan));
    } else if(service==="ca"){
      card.addClass("ca-price-pack").append($("<p class='ca-price-amount'>").text(priceText(plan.price)),$("<small class='price-vat-note'>").text(plan.vatNote));
      if(plan.details[0])card.append($("<p class='ca-price-description'>").text(planDetail(plan.details[0],plan,service)));
      const lines=$("<ul>");
      plan.details.slice(1).filter(Boolean).forEach(text=>lines.append($("<li>").text(planDetail(text,plan,service))));
      if(plan.term&&!plan.details.some(text=>text.startsWith("Thời gian sử dụng:")))lines.append($("<li>").text("Thời gian sử dụng: "+plan.term));
      card.append(lines,quoteButton($,plan));
    } else {
      const prefix={contract:"vc",invoice:"si",bhxh:"bh"}[service];
      card.addClass(prefix+"-pack");
      if(i===0)card.addClass(prefix+"-featured");
      card.append($("<p>").addClass(prefix+"-amount").text(priceText(plan.price)),$("<small class='price-vat-note'>").text(plan.vatNote));
      if(plan.old!==null) {
        const previous=$("<p>").addClass(prefix+"-old").append($("<del>").text(priceText(plan.old)));
        if(plan.discount!==null)previous.append($("<span>").text("−"+plan.discount+"%"));
        card.append(previous);
      }
      const details=$("<div>").addClass(prefix+"-description");
      plan.details.filter(Boolean).forEach(text=>details.append($("<p>").text(planDetail(text,plan,service))));
      if(plan.term&&!plan.details.some(line=>line.includes(plan.term)||line.startsWith("Thời gian sử dụng:")||/^Chữ ký số [0-9]+ tháng$/.test(line)))details.append($("<p>").text("Thời hạn: "+plan.term));
      card.append(details,quoteButton($,plan,prefix+"-register"));
    }
    target.append(card);
  }
  dialog.find(".ca-general-consult").attr("data-consult-service",service);
  if(!plans.length)target.append($("<p>").text("Vui lòng liên hệ để nhận báo giá."));
}

function home($:Document, data:SiteContent) {
  applyCopy($,data.pageContent.index);
  const catalog=data.serviceCatalog.filter(item=>item.enabled);
  const visible=new Set(catalog.map(item=>item.id));
  const originals=new Map($("#cards .card").toArray().map(node=>[$(node).attr("data-service"),$(node).clone()]));
  const cards=$("#cards").empty();
  catalog.forEach((item,index)=>{
    if(index%2===0)cards.append($("<div class='solution-pair'>"));
    const original=originals.get(item.id);
    const card=original??$("<article class='card tendoo-feature'><span class='num'></span><h3></h3><p></p><ul class='tendoo-benefits'></ul><img class='solution-image' loading='lazy'><div class='tendoo-actions'><a>Xem chi tiết</a><button type='button' class='tendoo-consult'>Nhận tư vấn ngay</button></div></article>");
    card.attr("data-service",item.id);
    card.find(".num").text(item.category);
    card.find("h3").text(item.detailTitle||item.name);
    card.find("p").first().text(item.description);
    const benefits=card.find(".tendoo-benefits").empty();
    item.points.filter(Boolean).forEach(text=>benefits.append($("<li>").text(text)));
    if(!item.points.some(Boolean))benefits.remove();
    if(item.image)card.find("img.solution-image").attr({src:item.image,alt:item.name});
    else card.find("img.solution-image").remove();
    const actions=card.find(".tendoo-actions");
    if(original) {
      actions.find("a").first().attr({href:"#discover","data-video-service":item.id}).removeAttr("target rel");
      const open=actions.children().filter((_,node)=>!$(node).hasClass("tendoo-consult")&&!$(node).attr("data-video-service")).first();
      open.attr({"data-open-price":item.id,"aria-haspopup":"dialog"});
    } else actions.find("a").attr("href",catalogUrl(item));
    actions.find(".tendoo-consult").attr("data-consult-service",item.id);
    cards.children(".solution-pair").last().append(card);
  });
  for(const id of services)renderPricing($,id,visible.has(id)?plansFor(data,id).filter(plan=>plan.enabled):[]);
  const options=[...catalog.map(({id,name})=>({id,name})),...additionalInterests];
  for(const item of options) {
    $("#choices").append($("<label class='check'>").append($("<input type='checkbox' name='products'>").val(item.id),$("<span>").text(item.name)));
  }
  const videos=data.videos.filter(item=>item.enabled&&(!item.service||visible.has(item.service))).flatMap(item=>{
    const source=videoSource(item.link);
    return source?[{...item,...source, poster:catalog.find(row=>row.id===item.service)?.image??""}]:[];
  });
  if(!videos.length)$("#discover,a[href='#discover']").remove();
  else {
    const videoServices=new Set(videos.map(item=>item.service));
    $("[data-video-service]").each((_,node)=>{if(!videoServices.has($(node).attr("data-video-service")!))$(node).remove();});
  }
  const {contact}=data;
  $(".hero .mini > div").first().find("b").text(catalog.length+" giải pháp");
  $("a[href='#tammi-contact']").attr({"data-open-qr":"","aria-haspopup":"dialog"});
  $("#tammi-contact img").attr("data-open-qr","").wrap($("<button type='button' class='thoai-qr-trigger' aria-label='Mở mã QR TAMMI'>"));
  const qr=$("<dialog id='tammiDialog' class='thoai-qr' aria-labelledby='tammiTitle'>").append(
    $("<div>").append(
      $("<button type='button' class='pricing-close-square thoai-qr-close' data-close aria-label='Đóng mã QR'>").text("×"),
      $("<h2 id='tammiTitle'>").text("Chat TAMMI với "+contact.name),
      $("<p>").text("Mở ứng dụng Viettel TAMMI, chọn Quét mã QR rồi quét mã bên dưới để kết nối."),
      $("<img>").attr({src:contact.qr,alt:"Mã QR TAMMI của "+contact.name}),
      $("<a class='btn' download>").attr("href",contact.qr.startsWith("/")?contact.qr:contact.qr+"?download=1").text("Tải ảnh mã QR")
    )
  );
  $("#solutionConsult .sc-close,#closeSuccess").attr("data-close","");
  const config={
    options,videos,
    plans:catalog.flatMap(item=>plansFor(data,item.id).filter(plan=>plan.enabled).map(plan=>({
      id:plan.id,serviceId:item.id,name:plan.name,price:plan.price,term:plan.term,vatNote:plan.vatNote
    })))
  };
  $("body").append(qr,$("<script type='application/json' id='thoai-config'>").text(JSON.stringify(config).replace(/</g,"\\u003c")),
    $("<script src='/thoai-site.js' defer>"),$("<link rel='stylesheet' href='/thoai-site.css'>"));
  applyContact($,contact);
}

function customPage($:Document, item:CatalogItem, data:SiteContent) {
  $("title").text(item.detailTitle||item.name);
  $("meta[name='description']").attr("content",item.detailIntro||item.description);
  $("body").empty().append($("<link rel='stylesheet' href='/thoai-site.css'>"));
  const url="/?san-pham="+encodeURIComponent(item.id);
  const main=$("<main class='wrap thoai-detail'>").append(
    $("<a href='/#solutions'>").text("← Xem các dịch vụ"),$("<p class='eyebrow'>").text(item.category),
    $("<h1>").text(item.detailTitle||item.name),$("<p class='lead'>").text(item.detailIntro||item.description),
    $("<a class='btn'>").attr("href",url+"#register").text("Nhận tư vấn ngay")
  );
  if(item.image)main.append($("<img class='thoai-detail-image'>").attr({src:item.image,alt:item.name}));
  if(item.points.some(Boolean)) {
    const list=$("<ul>");
    item.points.filter(Boolean).forEach(point=>list.append($("<li>").text(point)));
    main.append(list);
  }
  if(item.detailContent)main.append($("<p class='thoai-detail-copy'>").text(item.detailContent));
  if(item.official)main.append($("<p>").append($("<a target='_blank' rel='noopener'>").attr("href",item.official).text("Website Viettel")));
  const plans=plansFor(data,item.id).filter(plan=>plan.enabled);
  if(plans.length){
    main.append($("<h2>").text("Báo giá"));
    const list=$("<div class='thoai-detail-plans'>");
    for(const plan of plans)list.append($("<article>").append(
      $("<h3>").text(plan.name),$("<p>").text([priceText(plan.price),plan.term,plan.vatNote].filter(Boolean).join(" · ")),
      $("<p class='thoai-detail-copy'>").text(plan.details.filter(Boolean).join("\n")),
      $("<a class='btn'>").attr("href",url+"&goi="+encodeURIComponent(plan.id)+"#register").text("Chọn gói")
    ));
    main.append(list);
  }
  main.append($("<p>").append($("<a>").attr("href","tel:"+data.contact.hotline.replace(/[^\d+]/g,"")).text("Gọi "+data.contact.hotline)));
  $("body").append(main);
}

export async function renderSite(slug?:string) {
  let data=defaults;
  try {({data}=await readContent());}
  catch(error) {console.error("Thoại public content",(error as {code?:string})?.code??"unavailable");}
  const item=slug&&data.serviceCatalog.find(service=>service.enabled&&!isPriceService(service.id)&&service.slug===slug);
  if(slug&&!item)return new Response("Dịch vụ không còn hiển thị.",{status:404,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
  template??=readFile(process.cwd()+"/source/index.html","utf8");
  const $=load(await template);
  if(item)customPage($,item,data);else home($,data);
  return new Response($.html(),{headers:{
    "Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"strict-origin-when-cross-origin","X-Frame-Options":"SAMEORIGIN"
  }});
}
