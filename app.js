"use strict";

const API_URL = "https://4print-api.m01099842700.workers.dev/";
const PENDING_ORDER_KEY = "4print_pending_order_v1";
const MAX_PROOF_BYTES = 5 * 1024 * 1024;

let installPrompt = null;
let isSubmitting = false;
let products = [];
let cart = [];
let cartSequence = 0;

const $ = id => document.getElementById(id);

const installBtn = $("installBtn");
const testStatus = $("testStatus");
const productsStatus = $("productsStatus");
const productsList = $("productsList");
const materialSelect = $("materialSelect");
const addMaterialBtn = $("addMaterialBtn");
const connectionNotice = $("connectionNotice");
const selectedCount = $("selectedCount");
const orderTotal = $("orderTotal");
const bookingForm = $("bookingForm");
const bookingStatus = $("bookingStatus");
const submitOrderBtn = $("submitOrderBtn");
const newOrderBox = $("newOrderBox");
const statusForm = $("statusForm");
const statusMessage = $("statusMessage");
const orderStatusResult = $("orderStatusResult");
const proofForm = $("proofForm");
const proofMessage = $("proofMessage");
const submitProofBtn = $("submitProofBtn");

function setMessage(element, message, kind = "") {
  if (!element) return;
  element.textContent = message;
  element.classList.remove("status-ok", "status-error", "status-warn");
  if (kind) element.classList.add(kind);
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US", {maximumFractionDigits: 2}) : "—";
}

function normalizePhone(value) {
  return String(value || "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[\s()-]/g, "");
}

function validEgyptianPhone(value) {
  return /^01[0125]\d{8}$/.test(normalizePhone(value));
}

function makeIdempotencyKey() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  return "4p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

async function apiPost(route, data) {
  const response = await fetch(API_URL + "?api=" + encodeURIComponent(route), {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(data)
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); }
  catch (_) { throw new Error("لم تصل استجابة مفهومة من النظام. لا تكرر إرسال الحجز قبل مراجعة حالة الاتصال."); }
  if (!response.ok && result.success !== false) throw new Error("تعذر الاتصال بالنظام (HTTP " + response.status + ").");
  return result;
}

async function loadProducts() {
  setMessage(productsStatus, "جارٍ تحميل الخامات...");
  try {
    const response = await fetch(API_URL + "?api=products", {method: "GET", cache: "no-store"});
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    if (!data || data.success !== true || !Array.isArray(data.products)) {
      throw new Error("صيغة بيانات الخامات غير صحيحة");
    }
    products = data.products;
    const validCodes = new Set(products.map(p => String(p.code)));
    cart = cart.filter(entry => validCodes.has(String(entry.product.code)));
    renderProducts();
    updateSummary();
    setMessage(productsStatus, "تم تحميل " + products.length + " خامة.", "status-ok");
    if (connectionNotice) {
      connectionNotice.replaceChildren();
      const strong = document.createElement("strong");
      strong.textContent = "الاتصال ناجح";
      const span = document.createElement("span");
      span.textContent = "تم الاتصال بنظام الخامات.";
      connectionNotice.append(strong, span);
    }
    updateSummary();
  } catch (error) {
    setMessage(productsStatus, "تعذر تحميل الخامات: " + error.message, "status-error");
    setMessage(bookingStatus, "تعذر الاتصال بالنظام. أعد تحميل الصفحة بعد التأكد من الإنترنت.", "status-error");
    if (connectionNotice) {
      connectionNotice.replaceChildren();
      const strong = document.createElement("strong");
      strong.textContent = "تعذر الاتصال";
      const span = document.createElement("span");
      span.textContent = "تحقق من الإنترنت ثم أعد المحاولة.";
      connectionNotice.append(strong, span);
    }
    submitOrderBtn.disabled = true;
  }
}

function isDimensionalProduct(product) {
  if (!product) return false;
  if (String(product.pricingType || "").trim() === "مساحة") return true;
  if (product.pricingType && String(product.pricingType).trim() !== "مساحة") return false;
  if (product.requiresDimensions === true) return true;
  return String(product.code || "") === "W1000";
}

function renderProducts() {
  materialSelect.replaceChildren();
  const placeholder=document.createElement("option"); placeholder.value=""; placeholder.textContent="اختر الخامة لإضافتها"; materialSelect.append(placeholder);
  products.forEach(p=>{
    const code=String(p.code), dimensional=isDimensionalProduct(p), exists=cart.some(e=>String(e.product.code)===code);
    const stock=Math.max(0,Number(p.stock)||0);
    if(stock>0 && (dimensional || !exists)){
      const option=document.createElement("option"); option.value=code;
      option.textContent=String(p.name||code)+" — متاح: "+(dimensional?money(stock)+" م²":money(stock)+" "+(p.unit||""));
      materialSelect.append(option);
    }
  });
  addMaterialBtn.disabled=materialSelect.options.length<=1;
  productsList.replaceChildren();
  if(!cart.length){productsList.textContent="لم تتم إضافة خامات بعد. اختر خامة من القائمة أعلاه.";return;}
  const wrap=document.createElement("div");wrap.className="materials-table-wrap";
  const table=document.createElement("table");table.className="materials-table";
  const thead=document.createElement("thead"),hr=document.createElement("tr");
  ["الخامة","الطول (سم)","العرض (سم)","العدد","الإجمالي",""] .forEach((label,i)=>{const th=document.createElement("th");th.textContent=label;if((i===1||i===2)&&!cart.some(e=>isDimensionalProduct(e.product)))th.className="optional-dim-col";hr.append(th);});
  thead.append(hr);const tbody=document.createElement("tbody");
  cart.forEach(entry=>{
    const p=entry.product,dim=isDimensionalProduct(p),tr=document.createElement("tr");
    const name=document.createElement("td");name.textContent=p.name||p.code;tr.append(name);
    function dimCell(value,placeholder,field){const td=document.createElement("td");if(!dim){td.className="optional-dim-col";td.textContent="—";return td;}const input=document.createElement("input");input.type="number";input.min="0.01";input.step="0.01";input.inputMode="decimal";input.placeholder=placeholder;input.value=value||"";input.addEventListener("input",()=>{entry[field]=Number(input.value)||0;updateSummary();});td.append(input);return td;}
    tr.append(dimCell(entry.length,"الطول","length"),dimCell(entry.width,"العرض","width"));
    const qtyTd=document.createElement("td"),qty=document.createElement("input");qty.type="number";qty.min="1";qty.step="1";qty.inputMode="numeric";
    if(!dim)qty.max=String(Math.max(1,Number(p.stock)||0));qty.value=String(entry.quantity);
    qty.addEventListener("change",()=>{const max=dim?100000:Math.max(1,Number(p.stock)||1);const n=Math.max(1,Math.min(max,Math.floor(Number(qty.value)||1)));entry.quantity=n;qty.value=String(n);updateSummary();});qtyTd.append(qty);tr.append(qtyTd);
    const total=document.createElement("td");total.className="line-total";total.textContent=money(lineTotal(entry))+" جنيه";tr.append(total);
    const removeTd=document.createElement("td"),remove=document.createElement("button");remove.type="button";remove.className="remove-item";remove.textContent="إزالة";remove.addEventListener("click",()=>{cart=cart.filter(x=>x.id!==entry.id);renderProducts();updateSummary();});removeTd.append(remove);tr.append(removeTd);tbody.append(tr);
  });
  table.append(thead,tbody);wrap.append(table);productsList.append(wrap);
}

function lineTotal(entry) {
  const p = entry.product;
  const price = Number(p.price) || 0;
  if (isDimensionalProduct(p)) return Math.round((Number(entry.length)||0) * (Number(entry.width)||0) * price * (Number(entry.quantity)||0) * 100) / 100;
  return Math.round(price * (Number(entry.quantity)||0) * 100) / 100;
}

function addSelectedMaterial() {
  const code=materialSelect.value, p=products.find(x=>String(x.code)===code);if(!p)return;
  const dimensional=isDimensionalProduct(p);
  if(!dimensional && cart.some(e=>String(e.product.code)===code))return;
  cart.push({id:++cartSequence,product:p,quantity:1,length:0,width:0});
  renderProducts();updateSummary();
}
function selectedItems(){return cart.map(e=>({code:String(e.product.code),quantity:Number(e.quantity),length:Number(e.length)||0,width:Number(e.width)||0}));}
function updateSummary(){
  const count=cart.reduce((s,e)=>s+(Number(e.quantity)||0),0),total=cart.reduce((s,e)=>s+lineTotal(e),0);
  selectedCount.textContent=String(count);orderTotal.textContent=money(total);
  productsList.querySelectorAll(".line-total").forEach((cell,i)=>{if(cart[i])cell.textContent=money(lineTotal(cart[i]))+" جنيه";});
  submitOrderBtn.disabled=isSubmitting||products.length===0||cart.length===0||cart.some(e=>isDimensionalProduct(e.product)&&(!(e.length>0)||!(e.width>0)));
}

addMaterialBtn.addEventListener("click", addSelectedMaterial);

function showNewOrder(orderId, total, message) {
  newOrderBox.classList.remove("hidden");
  newOrderBox.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "تم تسجيل طلب الحجز";
  const id = document.createElement("p");
  id.textContent = "رقم الطلب: " + orderId;
  const totalLine = document.createElement("p");
  totalLine.textContent = "إجمالي الطلب: " + money(total) + " جنيه";
  const note = document.createElement("p");
  note.textContent = message || "احتفظ برقم الطلب للاستعلام عنه لاحقًا. لا يُحجز المخزون قبل اعتماد دفعة موجبة.";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "secondary";
  copy.textContent = "نسخ رقم الطلب";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(orderId);
      copy.textContent = "تم نسخ رقم الطلب";
    } catch (_) {
      copy.textContent = "انسخ رقم الطلب يدويًا";
    }
  });
  newOrderBox.append(heading, id, totalLine, note, copy);
  $("lookupOrderId").value = orderId;
  $("proofOrderId").value = orderId;
  $("lookupPhone").value = $("studentPhone").value;
  $("proofPhone").value = $("studentPhone").value;
}

bookingForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (isSubmitting) return;

  const name = $("studentName").value.trim().replace(/\s+/g, " ");
  const phone = normalizePhone($("studentPhone").value);
  const items = selectedItems();

  if (name.split(" ").filter(Boolean).length < 4) {
    setMessage(bookingStatus, "يرجى كتابة الاسم الرباعي كاملًا.", "status-error");
    return;
  }
  if (!validEgyptianPhone(phone)) {
    setMessage(bookingStatus, "يرجى إدخال رقم هاتف محمول مصري صحيح يبدأ بـ 010 أو 011 أو 012 أو 015.", "status-error");
    return;
  }
  if (!items.length) {
    setMessage(bookingStatus, "اختر خامة واحدة على الأقل.", "status-error");
    return;
  }
  const invalidDimensions = cart.some(entry => isDimensionalProduct(entry.product) && (!(entry.length > 0) || !(entry.width > 0)));
  if (invalidDimensions) { setMessage(bookingStatus, "أدخل الطول والعرض لكل خامة خشب قبل إرسال الطلب.", "status-error"); return; }

  let pending;
  try { pending = JSON.parse(localStorage.getItem(PENDING_ORDER_KEY) || "null"); } catch (_) {}
  if (pending && pending.idempotencyKey) {
    const samePayload = pending.name === name && pending.phone === phone && JSON.stringify(pending.items) === JSON.stringify(items);
    if (!samePayload) {
      setMessage(bookingStatus, "يوجد طلب سابق لم تُحسم نتيجته. لن نغيّر بياناته أو نعيد استخدام مفتاحه. استعلم عن الطلب السابق أولًا أو تواصل مع أمين المكتبة.", "status-warn");
      return;
    }
    setMessage(bookingStatus, "نعيد التحقق من نتيجة الإرسال السابق بنفس البيانات.", "status-warn");
  } else {
    pending = {name, phone, items, idempotencyKey: makeIdempotencyKey(), createdAt: Date.now()};
  }

  isSubmitting = true;
  submitOrderBtn.disabled = true;
  setMessage(bookingStatus, "جارٍ إرسال طلب الحجز...");
  try {
    localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(pending));
    const result = await apiPost("order", pending);
    if (result && result.success === true) {
      localStorage.removeItem(PENDING_ORDER_KEY);
      const orderId = result.orderId || result.id || "راجع رسالة نجاح الطلب";
      const total = result.total;
      setMessage(bookingStatus, "تم إرسال الطلب بنجاح.", "status-ok");
      showNewOrder(String(orderId), total, result.message);
      bookingForm.reset();
      cart = [];
      renderProducts();
      updateSummary();
      await loadProducts();
    } else {
      setMessage(bookingStatus, (result && result.error) || (result && result.message) || "لم يتم تسجيل الطلب. راجع البيانات وحاول مرة أخرى.", "status-error");
    }
  } catch (error) {
    setMessage(bookingStatus, error.message || "تعذر تأكيد نتيجة الإرسال. احتفظ بالصفحة وافحص حالة الاتصال قبل بدء طلب جديد.", "status-error");
  } finally {
    isSubmitting = false;
    updateSummary();
  }
});

statusForm.addEventListener("submit", async event => {
  event.preventDefault();
  const orderId = $("lookupOrderId").value.trim();
  const phone = normalizePhone($("lookupPhone").value);
  if (!validEgyptianPhone(phone)) {
    setMessage(statusMessage, "أدخل رقم هاتف محمول مصري صحيح.", "status-error");
    return;
  }
  setMessage(statusMessage, "جارٍ الاستعلام...");
  orderStatusResult.classList.add("hidden");
  try {
    const result = await apiPost("status", {orderId, phone});
    if (!result || result.success !== true) throw new Error((result && (result.error || result.message)) || "تعذر العثور على الطلب بهذه البيانات.");
    renderOrderStatus(result);
    setMessage(statusMessage, "تم جلب حالة الطلب.", "status-ok");
    $("proofOrderId").value = orderId;
    $("proofPhone").value = phone;
  } catch (error) {
    setMessage(statusMessage, error.message || "تعذر الاستعلام عن الطلب.", "status-error");
  }
});

function renderOrderStatus(data) {
  orderStatusResult.classList.remove("hidden");
  orderStatusResult.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "ملخص الطلب " + String(data.orderId || "");
  const dl = document.createElement("dl");
  const rows = [
    ["إجمالي الطلب", money(data.total) + " جنيه"],
    ["المبلغ المعتمد", money(data.paid) + " جنيه"],
    ["المبلغ قيد المراجعة", money(data.pending) + " جنيه"],
    ["المتبقي بعد المبالغ المعتمدة", money(data.remaining) + " جنيه"],
    ["المتاح لإرسال دفعة جديدة الآن", money(data.payableNow) + " جنيه"],
    ["حالة السداد", String(data.paymentStatus || "غير محددة")],
    ["حالة الطلب", String(data.status || "غير محددة")]
  ];
  rows.forEach(([label, value]) => {
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.textContent = value;
    dl.append(dt, dd);
  });
  const note = document.createElement("p");
  note.textContent = "إرسال الإيصال لا يعني اعتماده. إذا كان هناك مبلغ قيد المراجعة، انتظر مراجعة أمين المكتبة قبل إرسال إيصال آخر.";
  orderStatusResult.append(heading, dl, note);
}

proofForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (isSubmitting) return;
  const orderId = $("proofOrderId").value.trim();
  const phone = normalizePhone($("proofPhone").value);
  const amount = Number($("proofAmount").value);
  const file = $("proofFile").files && $("proofFile").files[0];

  if (!validEgyptianPhone(phone)) {
    setMessage(proofMessage, "أدخل رقم هاتف محمول مصري صحيح.", "status-error");
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    setMessage(proofMessage, "أدخل مبلغًا أكبر من صفر.", "status-error");
    return;
  }
  if (!file) {
    setMessage(proofMessage, "اختر ملف الإيصال أولًا.", "status-error");
    return;
  }
  if (file.size > MAX_PROOF_BYTES) {
    setMessage(proofMessage, "حجم الملف أكبر من 5 ميجابايت. اختر ملفًا أصغر.", "status-error");
    return;
  }
  const mime = String(file.type || "").toLowerCase();
  const ext = file.name.split(".").pop().toLowerCase();
  const validType = ["image/jpeg", "image/png", "application/pdf"].includes(mime) ||
    ["jpg", "jpeg", "png", "pdf"].includes(ext);
  if (!validType) {
    setMessage(proofMessage, "نوع الملف غير مدعوم. استخدم JPG أو PNG أو PDF.", "status-error");
    return;
  }

  isSubmitting = true;
  submitProofBtn.disabled = true;
  setMessage(proofMessage, "جارٍ تجهيز الإيصال وإرساله للمراجعة...");
  try {
    const base64 = await fileToBase64(file);
    const payload = {orderId, phone, amount, fileName: file.name, mimeType: mime || mimeFromExtension(ext), base64};
    const result = await apiPost("proof", payload);
    if (!result || result.success !== true) throw new Error((result && (result.error || result.message)) || "لم يتم إرسال الإيصال.");
    setMessage(proofMessage, result.message || "تم إرسال الإيصال بنجاح، وهو الآن بانتظار مراجعة أمين المكتبة.", "status-ok");
    proofForm.reset();
    $("lookupOrderId").value = orderId;
    $("lookupPhone").value = phone;
  } catch (error) {
    setMessage(proofMessage, error.message || "تعذر إرسال الإيصال. تحقق من الاتصال وحاول لاحقًا.", "status-error");
  } finally {
    isSubmitting = false;
    submitProofBtn.disabled = false;
  }
});

function mimeFromExtension(ext) {
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  return "image/jpeg";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("تعذر قراءة ملف الإيصال."));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("تعذر قراءة ملف الإيصال."));
    reader.readAsDataURL(file);
  });
}

$("paymentInfo").addEventListener("click", () => {
  alert("يمكن إرسال إيصال التحويل من النموذج المخصص. سيظل المبلغ قيد المراجعة حتى يعتمد أمين المكتبة السداد. اعتماد دفعة موجبة يحجز كامل كميات الطلب وفق قواعد النظام.");
});
$("dataInfo").addEventListener("click", () => {
  alert("تُحفظ الطلبات والمدفوعات وحركة المخزون في Google Sheets المرتبط بالنظام. هذه الواجهة لا تستبدل ملف البيانات ولا تنشئ ملفًا جديدًا.");
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  installBtn.classList.remove("hidden");
});
installBtn.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.classList.add("hidden");
});
window.addEventListener("appinstalled", () => {
  installBtn.classList.add("hidden");
  setMessage(testStatus, "تم تثبيت 4Print على الجهاز.", "status-ok");
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./service-worker.js");
      setMessage(testStatus, "دعم التطبيق وتسجيل Service Worker متاحان.", "status-ok");
    } catch (error) {
      setMessage(testStatus, "تعذر تسجيل Service Worker: " + error.message, "status-warn");
    }
  });
} else {
  setMessage(testStatus, "التثبيت غير متاح في سياق التصفح الحالي.", "status-warn");
}

loadProducts();
