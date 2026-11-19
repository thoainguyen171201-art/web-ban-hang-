(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const config = JSON.parse(byId("thoai-config").textContent);
  const mainForm = byId("form");
  const popupForm = byId("scForm");
  const success = byId("success");
  const floating = byId("floatingCall");
  const options = new Map(config.options.map(item => [item.id, item]));
  const planKey = (service, plan) => service + ":" + plan;
  const plans = new Map(config.plans.map(item => [planKey(item.serviceId, item.id), item]));
  const selectedQuotes = new Map();
  let popupChoice;
  let active;
  let returnFocus;
  let oldOverflow = "";

  function node(tag, text = "", className = "") {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  const money = value => value === null ? "Liên hệ báo giá" : new Intl.NumberFormat("vi-VN").format(value) + " ₫";

  function open(dialog) {
    if (!dialog || dialog === active) return;
    if (!active) {
      returnFocus = document.activeElement;
      oldOverflow = document.body.style.overflow;
    } else active.close();
    active = dialog;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    dialog.append(floating);
  }
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("close", () => {
      if (active !== dialog || dialog.open) return;
      active = null;
      document.body.style.overflow = oldOverflow;
      document.body.append(floating);
      returnFocus?.focus({preventScroll:true});
    });
  }

  const quoteList = node("div");
  quoteList.setAttribute("aria-live","polite");
  byId("choices").after(quoteList);
  function renderSelection() {
    quoteList.replaceChildren();
    for (const [service, plan] of selectedQuotes) {
      const row = node("div", plan.name + " · " + money(plan.price), "thoai-selected-quote");
      const remove = node("button", "Bỏ gói");
      remove.type = "button";
      remove.onclick = () => { selectedQuotes.delete(service); renderSelection(); };
      row.append(remove);
      quoteList.append(row);
    }
  }
  function selectProduct(serviceId, plan) {
    const input = [...mainForm.querySelectorAll("input[name=products]")].find(field => field.value === serviceId);
    if (!input) return;
    input.checked = true;
    if (plan) selectedQuotes.set(serviceId, plan);
    renderSelection();
  }
  byId("choices").addEventListener("change", event => {
    const input = event.target;
    if (!input.checked) { selectedQuotes.delete(input.value); renderSelection(); }
  });
  const requested = new URLSearchParams(location.search);
  const requestedService = requested.get("san-pham");
  selectProduct(requestedService, plans.get(planKey(requestedService, requested.get("goi"))));

  function consult(serviceId, plan) {
    const service = options.get(serviceId);
    if (!service) return;
    popupChoice = {serviceId, plan};
    selectProduct(serviceId, plan);
    byId("scTitle").textContent = (plan ? "Đăng ký mua gói " : "Đăng ký tư vấn ") + service.name;
    byId("scPlan").textContent = plan?.name || service.name + " – Tư vấn giải pháp";
    byId("scTerm").textContent = plan?.term || "Theo gói dịch vụ lựa chọn";
    byId("scPrice").textContent = plan ? money(plan.price) : "Liên hệ tư vấn";
    byId("scVat").textContent = plan?.vatNote || "";
    byId("scStatus").textContent = "";
    byId("scChange").hidden = !plan;
    open(byId("solutionConsult"));
  }
  byId("scChange").onclick = () => {
    const pricing = document.querySelector("[data-price-service='" + popupChoice.serviceId + "']");
    if (pricing) open(pricing);
    else active?.close();
  };

  const filters = text => text.toLocaleLowerCase("vi").normalize("NFD").replace(/\p{M}/gu,"").replace(/đ/g,"d");
  function bindPricing(dialog) {
    const service = dialog.dataset.priceService;
    const search = dialog.querySelector('input[type="search"]');
    const category = dialog.querySelector("select");
    const cards = [...dialog.querySelectorAll("article[data-group]")];
    const counter = dialog.querySelector("[role=status], #tdCount");
    const empty = dialog.querySelector(".vc-empty,.si-empty,.bh-empty");
    let tendooGroup = "packages";
    const tabs = [...dialog.querySelectorAll("[data-kind]")];
    function update() {
      const keyword = filters(search?.value.trim() || "");
      const group = service === "tendoo" ? tendooGroup : category?.value;
      const upper = byId("tdRange")?.value;
      const term = byId("tdTime")?.value;
      let count = 0;
      for (const card of cards) {
        const plan = plans.get(planKey(service, card.querySelector("[data-plan-id]").dataset.planId));
        const type = card.dataset.group;
        const matches = !group || group === "all" || group === type || (group === "single" && service === "bhxh" && type !== "combo");
        const amountMatches = service !== "tendoo" || upper === "all" || (plan.price !== null && plan.price <= Number(upper));
        const termMatches = service !== "tendoo" || term === "all" || term === plan.term;
        card.hidden = !(matches && amountMatches && termMatches && filters(card.textContent).includes(keyword));
        if (!card.hidden) count++;
      }
      if (counter) counter.textContent = service === "tendoo" ? "Đã lọc được " + count + " kết quả" : count + " gói dịch vụ";
      if (empty) empty.hidden = count > 0;
    }
    function choose(kind) {
      tendooGroup = kind;
      tabs.forEach(tab => tab.setAttribute("aria-pressed",String(tab.dataset.kind===kind)));
      const terms = [...new Set(cards.filter(card=>card.dataset.group===kind).map(card=>card.querySelector(".td-duration b").textContent).filter(term=>term!=="—"))];
      byId("tdTime").replaceChildren(new Option("Tất cả thời hạn","all"),...terms.map(term=>new Option(term,term)));
      update();
    }
    search?.addEventListener("input",update);
    category?.addEventListener("change",update);
    if (service === "tendoo") {
      tabs.forEach(tab => tab.onclick=()=>choose(tab.dataset.kind));
      byId("tdTime").onchange = update;
      byId("tdRange").onchange = update;
      byId("tdReset").onclick = () => { search.value=""; byId("tdRange").value="all"; byId("tdTime").value="all"; update(); };
      choose(tendooGroup);
    } else update();
  }
  document.querySelectorAll("[data-price-service]").forEach(bindPricing);

  const discovery = byId("discover");
  let videoIndex = 0;
  if (discovery) {
    const source = byId("discoverExternal"), mount = byId("discoverMedia"), list = discovery.querySelector(".discover-options");
    const indexes = ["tendoo","ca","contract","invoice","bhxh","ftth"];
    function showVideo(index) {
      const item = config.videos[index];
      if (!item) return;
      videoIndex = index;
      [...list.children].forEach((button,i)=>button.setAttribute("aria-pressed",String(i===index)));
      byId("discoverCategory").textContent = "KHÁM PHÁ / " + item.title;
      byId("discoverName").textContent = item.name || item.title;
      byId("discoverDescription").textContent = item.description;
      source.href = item.url;
      source.textContent = item.kind === "youtube" ? "Xem trên YouTube " : "Mở video giới thiệu ";
      mount.replaceChildren();
      if (item.kind === "mp4") {
        const media = node("video");
        media.src = item.embed;
        media.controls = true;
        media.playsInline = true;
        media.preload = "none";
        if (item.poster) media.poster = item.poster;
        media.setAttribute("aria-label", "Video giới thiệu " + (item.name || item.title));
        mount.append(media);
        return;
      }
      const button = node("button","","discover-play");
      button.type = "button";
      button.setAttribute("aria-label","Phát video " + (item.name || item.title));
      const youtube = new URL(item.embed).pathname.match(/^\/embed\/([\w-]{11})$/)?.[1];
      const image = node("img");
      if (youtube) {
        image.src = "https://i.ytimg.com/vi/" + youtube + "/hqdefault.jpg";
        image.alt = "Video giới thiệu " + (item.name || item.title);
        image.loading = "lazy";
        button.append(image);
      }
      if (youtube) {
        const icon = node("span","▶");
        icon.setAttribute("aria-hidden","true");
        button.append(icon);
      } else button.textContent = "Phát playlist";
      button.onclick = () => {
        const iframe = node("iframe");
        const address = new URL(item.embed);
        address.searchParams.set("autoplay","1");
        iframe.src = address.href;
        iframe.title = item.name || item.title;
        iframe.allow = "autoplay; encrypted-media; picture-in-picture; web-share";
        iframe.allowFullscreen = true;
        mount.replaceChildren(iframe);
      };
      mount.append(button);
    }
    for (const [i,item] of config.videos.entries()) {
      const button = node("button","","discover-option");
      button.type = "button";
      const markIndex = indexes.indexOf(item.service);
      const mark = node("span", markIndex===5 ? "FTTH" : "", "discover-wordmark" + (markIndex>=0 ? " discover-brand-"+markIndex : ""));
      mark.setAttribute("aria-hidden","true");
      if (item.id==="video-6") {
        const logo = node("img"); logo.src="/assets/tammi-chat-logo.png"; logo.alt=""; mark.append(logo);
      }
      button.append(node("strong",String(i+1).padStart(2,"0")+". "+item.title),mark);
      button.onclick = () => showVideo(i);
      list.append(button);
    }
    for (const link of document.querySelectorAll("[data-video-service]")) {
      link.addEventListener("click",event => {
        event.preventDefault();
        showVideo(config.videos.findIndex(item=>item.service===link.dataset.videoService));
        discovery.scrollIntoView({behavior:"smooth"});
      });
    }
    byId("discoverConsult").onclick = () => {
      selectProduct(config.videos[videoIndex].service);
      byId("discoverConsultClose").hidden = false;
      mainForm.scrollIntoView({behavior:"smooth",block:"start"});
    };
    byId("discoverConsultClose").onclick = event => {
      event.currentTarget.hidden = true;
      byId("discoverConsult").focus({preventScroll:true});
      discovery.scrollIntoView({block:"start"});
    };
    showVideo(0);
  }

  document.addEventListener("click",event => {
    const button = event.target.closest("[data-close],[data-open-price],[data-plan-id],[data-open-qr],[data-consult-service]");
    if (!button) return;
    event.preventDefault();
    if ("close" in button.dataset) active?.close();
    else if ("openQr" in button.dataset) open(byId("tammiDialog"));
    else if (button.dataset.openPrice) open(document.querySelector("[data-price-service='" + button.dataset.openPrice + "']"));
    else if (button.dataset.planId) {
      const id = button.closest("[data-price-service]").dataset.priceService;
      consult(id,plans.get(planKey(id,button.dataset.planId)));
    } else consult(button.dataset.consultService);
  });

  const requests = new WeakMap();
  for (const form of [mainForm,popupForm]) {
    form.addEventListener("submit",async event => {
      event.preventDefault();
      const submit = form.querySelector('[type=submit]');
      if (submit.disabled) return;
      const status = form === mainForm ? byId("status") : byId("scStatus");
      const fields = new FormData(form);
      const products = form === mainForm ? fields.getAll("products") : [popupChoice.serviceId];
      if (!products.length) { status.textContent = "Bạn vui lòng chọn ít nhất một sản phẩm."; return; }
      const quotes = form === mainForm
        ? [...selectedQuotes.values()].map(plan => ({serviceId:plan.serviceId,planId:plan.id}))
        : popupChoice.plan ? [{serviceId:popupChoice.serviceId,planId:popupChoice.plan.id}] : [];
      const payload = {
        name:fields.get("name"), phone:fields.get("phone"), email:fields.get("email"),
        company:fields.get("company") || "",needs:fields.get("needs") || "",
        consent:fields.has("consent"),website:fields.get("website") || "",products,quotes
      };
      const signature = JSON.stringify(payload);
      const last = requests.get(form);
      const requestId = last?.signature === signature ? last.id : crypto.randomUUID();
      requests.set(form,{signature,id:requestId});
      submit.disabled = true;
      status.textContent = "Đang lưu đăng ký…";
      try {
        const response = await fetch("/api/consult", {
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,requestId}),
          signal:AbortSignal.timeout(20_000)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Chưa thể ghi nhận yêu cầu.");
        byId("mailStatus").textContent = "Yêu cầu đã được lưu. Hệ thống sẽ gửi email xác nhận.";
        byId("summary").textContent = [
          "Mã đăng ký: "+result.id,"Họ tên: "+payload.name,"Email: "+payload.email,
          "Sản phẩm: "+result.products.join(", ")
        ].join("\n");
        if (form===mainForm) {selectedQuotes.clear(); renderSelection();}
        form.reset();
        requests.delete(form);
        status.textContent = "Thông tin đã được lưu.";
        open(success);
      } catch(error) {
        status.textContent = error.name==="TimeoutError" ? "Kết nối quá lâu. Bạn có thể thử gửi lại." : error.message;
      } finally { submit.disabled = false; }
    });
  }
  const navigation = document.querySelector("body > nav");
  const updateHeight = () => document.documentElement.style.setProperty("--site-nav-height",navigation.offsetHeight+"px");
  updateHeight();
  if ("ResizeObserver" in window) new ResizeObserver(updateHeight).observe(navigation);
})();
