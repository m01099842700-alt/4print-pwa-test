
"use strict";

/* =========================================================
   4Print - واجهة حجز خامات مكتبة كلية الفنون الجميلة
   الملف: app.js
   الاتصال: Cloudflare Worker -> Google Apps Script
   لا يمسح هذا الملف بيانات Google Sheets.
   ========================================================= */

const API_URL = "https://4print-api.m01099842700.workers.dev/";
const PENDING_ORDER_KEY = "4print_pending_order_v1";
const MAX_PROOF_BYTES = 5 * 1024 * 1024;

let installPrompt = null;
let isSubmitting = false;
let isProofSubmitting = false;
let isStatusChecking = false;
let products = [];
let quantities = Object.create(null);

const $ = id => document.getElementById(id);

/* عناصر الواجهة */
const installBtn = $("installBtn");
const testStatus = $("testStatus");
const productsStatus = $("productsStatus");
const productsList = $("productsList");
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

/* =========================================================
   أدوات عامة
   ========================================================= */

function setMessage(element, message, kind = "") {
  if (!element) return;

  element.textContent = message;
  element.classList.remove(
    "status-ok",
    "status-error",
    "status-warn"
  );

  if (kind) element.classList.add(kind);
}

function money(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      })
    : "—";
}

function normalizePhone(value) {
  return String(value || "")
    .replace(/[٠-٩]/g, digit =>
      String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))
    )
    .replace(/[۰-۹]/g, digit =>
      String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))
    )
    .replace(/[\s()-]/g, "");
}

function validEgyptianPhone(value) {
  return /^01[0125]\d{8}$/.test(normalizePhone(value));
}

function makeIdempotencyKey() {
  if (
    window.crypto &&
    typeof window.crypto.randomUUID === "function"
  ) {
    return window.crypto.randomUUID();
  }

  return "4p-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 14);
}

function readPendingOrder() {
  let raw;

  try {
    raw = localStorage.getItem(PENDING_ORDER_KEY);
  } catch (_) {
    throw new Error(
      "تعذر الوصول إلى التخزين المحلي. لا تبدأ حجزًا جديدًا قبل مراجعة حالة أي محاولة سابقة."
    );
  }

  if (!raw) return null;

  let pending;

  try {
    pending = JSON.parse(raw);
  } catch (_) {
    throw new Error(
      "بيانات محاولة الحجز المحفوظة غير قابلة للقراءة. لا تمسحها ولا تنشئ طلبًا بديلًا قبل مراجعة الطلبات."
    );
  }

  if (
    !pending ||
    typeof pending !== "object" ||
    typeof pending.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9_-]{20,100}$/.test(pending.idempotencyKey) ||
    typeof pending.name !== "string" ||
    typeof pending.phone !== "string" ||
    !Array.isArray(pending.items) ||
    pending.items.length === 0
  ) {
    throw new Error(
      "توجد محاولة حجز محفوظة لكن بياناتها غير مكتملة. لا تمسحها ولا تبدأ طلبًا جديدًا قبل مراجعة الحالة."
    );
  }

  return pending;
}

function savePendingOrder(pending) {
  try {
    localStorage.setItem(
      PENDING_ORDER_KEY,
      JSON.stringify(pending)
    );
  } catch (_) {
    throw new Error(
      "تعذر حفظ بيانات المحاولة بأمان. لم يتم إرسال الطلب."
    );
  }
}

function clearPendingOrder() {
  try {
    localStorage.removeItem(PENDING_ORDER_KEY);
  } catch (_) {
    // لا نخفي أي مشكلة أخرى؛ نترك المحاولة محفوظة إن تعذر الحذف.
  }
}

async function apiPost(route, data) {
  let response;

  try {
    response = await fetch(
      API_URL + "?api=" + encodeURIComponent(route),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data),
        cache: "no-store"
      }
    );
  } catch (_) {
    throw new Error(
      "تعذر الاتصال بالنظام. احتفظ بالمحاولة الحالية ولا تنشئ طلبًا جديدًا قبل التحقق من حالة الطلب."
    );
  }

  const responseText = await response.text();
  let result;

  try {
    result = JSON.parse(responseText);
  } catch (_) {
    throw new Error(
      "لم تصل استجابة مفهومة من النظام. لا تكرر الحجز قبل مراجعة حالة الاتصال والطلب."
    );
  }

  if (!response.ok) {
    throw new Error(
      result && (result.error || result.message)
        ? result.error || result.message
        : "تعذر الاتصال بالنظام (HTTP " + response.status + ")."
    );
  }

  return result;
}

/* =========================================================
   قراءة الخامات
   ========================================================= */

async function loadProducts() {
  if (productsStatus) {
    setMessage(productsStatus, "جارٍ تحميل الخامات...");
  }

  try {
    const response = await fetch(
      API_URL + "?api=products",
      {
        method: "GET",
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const data = await response.json();

    if (
      !data ||
      data.success !== true ||
      !Array.isArray(data.products)
    ) {
      throw new Error("صيغة بيانات الخامات غير صحيحة.");
    }

    products = data.products;

    const validCodes = new Set(
      products.map(product => String(product.code))
    );

    Object.keys(quantities).forEach(code => {
      if (!validCodes.has(code)) {
        delete quantities[code];
      }
    });

    renderProducts();
    updateSummary();

    setMessage(
      productsStatus,
      "تم تحميل " + products.length + " خامة.",
      "status-ok"
    );

    if (connectionNotice) {
      connectionNotice.replaceChildren();

      const strong = document.createElement("strong");
      strong.textContent = "الاتصال ناجح";

      const span = document.createElement("span");
      span.textContent = "تم الاتصال بنظام الخامات.";

      connectionNotice.append(strong, span);
    }

    if (submitOrderBtn) {
      submitOrderBtn.disabled =
        products.length === 0 ||
        isSubmitting ||
        selectedItems().length === 0;
    }

  } catch (error) {
    setMessage(
      productsStatus,
      "تعذر تحميل الخامات: " + error.message,
      "status-error"
    );

    setMessage(
      bookingStatus,
      "تعذر الاتصال بالنظام. تحقق من الإنترنت ثم أعد تحميل الصفحة.",
      "status-error"
    );

    if (connectionNotice) {
      connectionNotice.replaceChildren();

      const strong = document.createElement("strong");
      strong.textContent = "تعذر الاتصال";

      const span = document.createElement("span");
      span.textContent = "تحقق من الإنترنت ثم أعد المحاولة.";

      connectionNotice.append(strong, span);
    }

    if (submitOrderBtn) {
      submitOrderBtn.disabled = true;
    }
  }
}

/* =========================================================
   عرض الخامات والتحكم في الكميات
   ========================================================= */

function renderProducts() {
  if (!productsList) return;

  productsList.replaceChildren();

  if (!products.length) {
    productsList.textContent =
      "لا توجد خامات متاحة للعرض حاليًا.";
    return;
  }

  products.forEach(product => {
    const code = String(product.code);
    const stock = Math.max(0, Number(product.stock) || 0);
    const qty = Number(quantities[code]) || 0;

    const card = document.createElement("div");
    card.className = "product";

    const info = document.createElement("div");

    const name = document.createElement("h3");
    name.textContent = String(product.name || "خامة");

    const meta = document.createElement("div");
    meta.className = "product-meta";
    meta.textContent =
      "السعر: " + money(product.price) +
      " جنيه · المتاح: " + money(stock) +
      " " + String(product.unit || "");

    info.append(name, meta);

    const controls = document.createElement("div");
    controls.className = "product-controls";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "qty-btn";
    minus.textContent = "−";
    minus.setAttribute(
      "aria-label",
      "تقليل كمية " + String(product.name || "")
    );
    minus.disabled = qty <= 0;
    minus.addEventListener("click", () => {
      changeQuantity(code, -1);
    });

    const qtyText = document.createElement("span");
    qtyText.className = "qty";
    qtyText.textContent = String(qty);

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "qty-btn";
    plus.textContent = "+";
    plus.setAttribute(
      "aria-label",
      "زيادة كمية " + String(product.name || "")
    );
    plus.disabled = qty >= stock || stock <= 0;
    plus.addEventListener("click", () => {
      changeQuantity(code, 1);
    });

    controls.append(minus, qtyText, plus);
    card.append(info, controls);
    productsList.append(card);
  });
}

function changeQuantity(code, delta) {
  const product = products.find(
    item => String(item.code) === String(code)
  );

  if (!product) return;

  const stock = Math.max(0, Number(product.stock) || 0);
  const current = Number(quantities[code]) || 0;
  const next = Math.max(
    0,
    Math.min(stock, current + delta)
  );

  if (next === 0) {
    delete quantities[code];
  } else {
    quantities[code] = next;
  }

  renderProducts();
  updateSummary();
}

function selectedItems() {
  return products
    .filter(product =>
      Number(quantities[String(product.code)]) > 0
    )
    .map(product => ({
      code: String(product.code),
      name: String(product.name || ""),
      quantity: Number(quantities[String(product.code)]),
      price: Number(product.price) || 0
    }));
}

function updateSummary() {
  const items = selectedItems();

  const count = items.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const total = items.reduce(
    (sum, item) => sum + item.quantity * item.price,
    0
  );

  if (selectedCount) {
    selectedCount.textContent = String(count);
  }

  if (orderTotal) {
    orderTotal.textContent = money(total);
  }

  if (submitOrderBtn) {
    submitOrderBtn.disabled =
      isSubmitting ||
      products.length === 0 ||
      items.length === 0;
  }
}

/* =========================================================
   عرض نتيجة تسجيل الطلب
   ========================================================= */

function showNewOrder(orderId, total, message, phone) {
  if (!newOrderBox) return;

  newOrderBox.classList.remove("hidden");
  newOrderBox.replaceChildren();

  const heading = document.createElement("h3");
  heading.textContent = "تم تسجيل طلب الحجز";

  const id = document.createElement("p");
  id.textContent = "رقم الطلب: " + orderId;

  const totalLine = document.createElement("p");
  totalLine.textContent =
    "إجمالي الطلب: " + money(total) + " جنيه";

  const note = document.createElement("p");
  note.textContent = message ||
    "احتفظ برقم الطلب للاستعلام عنه لاحقًا. لا يُحجز المخزون قبل اعتماد دفعة موجبة.";

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

  if ($("lookupOrderId")) {
    $("lookupOrderId").value = orderId;
  }

  if ($("proofOrderId")) {
    $("proofOrderId").value = orderId;
  }

  if ($("lookupPhone")) {
    $("lookupPhone").value = phone || "";
  }

  if ($("proofPhone")) {
    $("proofPhone").value = phone || "";
  }
}

/* =========================================================
   تسجيل طلب حجز
   ========================================================= */

if (bookingForm) {
  bookingForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (isSubmitting) return;

    let pending;

    /*
     * أولًا: افحص المحاولة المحفوظة.
     * إذا وُجدت، استخدم بياناتها الأصلية ولا تستبدلها
     * بالبيانات الحالية في النموذج.
     */
    try {
      pending = readPendingOrder();
    } catch (error) {
      setMessage(
        bookingStatus,
        error.message,
        "status-error"
      );
      return;
    }

    if (pending) {
      const confirmRetry = window.confirm(
        "توجد محاولة حجز سابقة لم تُحسم نتيجتها.\n\n" +
        "سيُعاد إرسال بيانات المحاولة الأصلية نفسها للتحقق من نتيجتها، " +
        "ولن تُستخدم الكميات أو البيانات الحالية في النموذج.\n\n" +
        "هل تريد المتابعة؟"
      );

      if (!confirmRetry) {
        setMessage(
          bookingStatus,
          "لم يُرسل أي طلب جديد. بقيت المحاولة السابقة محفوظة.",
          "status-warn"
        );
        return;
      }

    } else {
      const name = $("studentName")
        ? $("studentName").value.trim().replace(/\s+/g, " ")
        : "";

      const phone = normalizePhone(
        $("studentPhone") ? $("studentPhone").value : ""
      );

      const items = selectedItems();

      if (name.split(" ").filter(Boolean).length < 4) {
        setMessage(
          bookingStatus,
          "يرجى كتابة الاسم الرباعي كاملًا.",
          "status-error"
        );
        return;
      }

      if (!validEgyptianPhone(phone)) {
        setMessage(
          bookingStatus,
          "يرجى إدخال رقم هاتف محمول مصري صحيح يبدأ بـ 010 أو 011 أو 012 أو 015.",
          "status-error"
        );
        return;
      }

      if (!items.length) {
        setMessage(
          bookingStatus,
          "اختر كمية من خامة واحدة على الأقل.",
          "status-error"
        );
        return;
      }

      pending = {
        name: name,
        phone: phone,
        items: items.map(item => ({
          code: item.code,
          name: item.name,
          quantity: item.quantity,
          price: item.price
        })),
        idempotencyKey: makeIdempotencyKey(),
        createdAt: Date.now()
      };

      /*
       * احفظ بيانات الطلب ومفتاحه قبل الاتصال بالخادم.
       * عند انقطاع الاتصال يمكن إعادة المحاولة بالمفتاح نفسه.
       */
      try {
        savePendingOrder(pending);
      } catch (error) {
        setMessage(
          bookingStatus,
          error.message,
          "status-error"
        );
        return;
      }
    }

    isSubmitting = true;

    if (submitOrderBtn) {
      submitOrderBtn.disabled = true;
    }

    setMessage(
      bookingStatus,
      "جارٍ التحقق من نتيجة محاولة الحجز وإرسال بياناتها الأصلية..."
    );

    try {
      const result = await apiPost("order", pending);

      if (result && result.success === true) {
        const orderId = String(
          result.orderId || result.id || ""
        );

        if (!orderId) {
          /*
           * لا نحذف المحاولة عند غياب رقم الطلب؛
           * فقد يكون الخادم سجل الطلب بالفعل.
           */
          throw new Error(
            "أعاد النظام نتيجة غير مكتملة دون رقم الطلب. بقيت المحاولة محفوظة؛ لا تنشئ طلبًا جديدًا."
          );
        }

        /*
         * أزل المحاولة فقط بعد استلام نجاح واضح ورقم طلب.
         */
        clearPendingOrder();

        setMessage(
          bookingStatus,
          result.duplicate
            ? "تم العثور على الطلب المسجل سابقًا."
            : "تم إرسال الطلب بنجاح.",
          "status-ok"
        );

        showNewOrder(
          orderId,
          result.total,
          result.message,
          pending.phone
        );

        /*
         * لا نمسح النموذج والكميات إلا بعد نجاح مؤكد.
         */
        bookingForm.reset();
        quantities = Object.create(null);
        renderProducts();
        updateSummary();

        await loadProducts();

      } else {
        /*
         * نحتفظ بالمحاولة عند النتيجة غير الحاسمة،
         * منعًا لإنشاء طلب مكرر عن طريق الخطأ.
         */
        setMessage(
          bookingStatus,
          (result && (result.error || result.message)) ||
            "لم يؤكد النظام تسجيل الطلب. بقيت المحاولة محفوظة؛ راجع حالة الطلب قبل أي محاولة جديدة.",
          "status-error"
        );
      }

    } catch (error) {
      setMessage(
        bookingStatus,
        (error.message || "تعذر تأكيد نتيجة الإرسال.") +
          " بقيت بيانات المحاولة محفوظة. لا تمسحها ولا تبدأ طلبًا بديلًا قبل التحقق من حالة الطلب.",
        "status-error"
      );

    } finally {
      isSubmitting = false;
      updateSummary();
    }
  });
}

/* =========================================================
   الاستعلام عن حالة الطلب
   ========================================================= */

if (statusForm) {
  statusForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (isStatusChecking) return;

    const orderId = $("lookupOrderId")
      ? $("lookupOrderId").value.trim()
      : "";

    const phone = normalizePhone(
      $("lookupPhone") ? $("lookupPhone").value : ""
    );

    if (!orderId) {
      setMessage(
        statusMessage,
        "أدخل رقم الطلب.",
        "status-error"
      );
      return;
    }

    if (!validEgyptianPhone(phone)) {
      setMessage(
        statusMessage,
        "أدخل رقم هاتف محمول مصري صحيحًا.",
        "status-error"
      );
      return;
    }

    isStatusChecking = true;

    setMessage(statusMessage, "جارٍ الاستعلام...");

    if (orderStatusResult) {
      orderStatusResult.classList.add("hidden");
    }

    try {
      const result = await apiPost("status", {
        orderId: orderId,
        phone: phone
      });

      if (!result || result.success !== true) {
        throw new Error(
          (result && (result.error || result.message)) ||
            "تعذر العثور على الطلب بهذه البيانات."
        );
      }

      renderOrderStatus(result);

      setMessage(
        statusMessage,
        "تم جلب حالة الطلب.",
        "status-ok"
      );

      if ($("proofOrderId")) {
        $("proofOrderId").value = orderId;
      }

      if ($("proofPhone")) {
        $("proofPhone").value = phone;
      }

    } catch (error) {
      setMessage(
        statusMessage,
        error.message || "تعذر الاستعلام عن الطلب.",
        "status-error"
      );

    } finally {
      isStatusChecking = false;
    }
  });
}

function renderOrderStatus(data) {
  if (!orderStatusResult) return;

  orderStatusResult.classList.remove("hidden");
  orderStatusResult.replaceChildren();

  const heading = document.createElement("h3");
  heading.textContent =
    "ملخص الطلب " + String(data.orderId || "");

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
    const dt = document.createElement("dt");
    dt.textContent = label;

    const dd = document.createElement("dd");
    dd.textContent = value;

    dl.append(dt, dd);
  });

  const note = document.createElement("p");
  note.textContent =
    "إرسال الإيصال لا يعني اعتماده. إذا كان هناك مبلغ قيد المراجعة، انتظر مراجعة أمين المكتبة قبل إرسال إيصال آخر.";

  orderStatusResult.append(heading, dl, note);
}

/* =========================================================
   إرسال إثبات التحويل
   ========================================================= */

if (proofForm) {
  proofForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (isProofSubmitting) return;

    const orderId = $("proofOrderId")
      ? $("proofOrderId").value.trim()
      : "";

    const phone = normalizePhone(
      $("proofPhone") ? $("proofPhone").value : ""
    );

    const amount = Number(
      $("proofAmount") ? $("proofAmount").value : NaN
    );

    const fileInput = $("proofFile");
    const file = fileInput && fileInput.files
      ? fileInput.files[0]
      : null;

    if (!orderId) {
      setMessage(
        proofMessage,
        "أدخل رقم الطلب.",
        "status-error"
      );
      return;
    }

    if (!validEgyptianPhone(phone)) {
      setMessage(
        proofMessage,
        "أدخل رقم هاتف محمول مصري صحيح.",
        "status-error"
      );
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage(
        proofMessage,
        "أدخل مبلغًا أكبر من صفر.",
        "status-error"
      );
      return;
    }

    if (!file) {
      setMessage(
        proofMessage,
        "اختر ملف الإيصال أولًا.",
        "status-error"
      );
      return;
    }

    if (file.size > MAX_PROOF_BYTES) {
      setMessage(
        proofMessage,
        "حجم الملف أكبر من 5 ميجابايت. اختر ملفًا أصغر.",
        "status-error"
      );
      return;
    }

    const mime = String(file.type || "").toLowerCase();
    const extension = file.name.split(".").pop().toLowerCase();

    const validType =
      ["image/jpeg", "image/png", "application/pdf"].includes(mime) ||
      ["jpg", "jpeg", "png", "pdf"].includes(extension);

    if (!validType) {
      setMessage(
        proofMessage,
        "نوع الملف غير مدعوم. استخدم JPG أو PNG أو PDF.",
        "status-error"
      );
      return;
    }

    isProofSubmitting = true;

    if (submitProofBtn) {
      submitProofBtn.disabled = true;
    }

    setMessage(
      proofMessage,
      "جارٍ تجهيز الإيصال وإرساله للمراجعة..."
    );

    try {
      const base64 = await fileToBase64(file);

      const payload = {
        orderId: orderId,
        phone: phone,
        amount: amount,
        fileName: file.name,
        mimeType: mime || mimeFromExtension(extension),
        base64: base64
      };

      const result = await apiPost("proof", payload);

      if (!result || result.success !== true) {
        throw new Error(
          (result && (result.error || result.message)) ||
            "لم يتم تأكيد إرسال الإيصال."
        );
      }

      setMessage(
        proofMessage,
        result.message ||
          "تم إرسال الإيصال، وهو الآن بانتظار مراجعة أمين المكتبة.",
        "status-ok"
      );

      proofForm.reset();

      if ($("lookupOrderId")) {
        $("lookupOrderId").value = orderId;
      }

      if ($("lookupPhone")) {
        $("lookupPhone").value = phone;
      }

    } catch (error) {
      setMessage(
        proofMessage,
        (error.message || "تعذر إرسال الإيصال.") +
          " إذا لم تتأكد من النتيجة، استعلم عن حالة الطلب قبل إرسال الإيصال مرة أخرى.",
        "status-error"
      );

    } finally {
      isProofSubmitting = false;

      if (submitProofBtn) {
        submitProofBtn.disabled = false;
      }
    }
  });
}

function mimeFromExtension(extension) {
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  return "image/jpeg";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");

      if (comma < 0) {
        reject(new Error("تعذر قراءة ملف الإيصال."));
        return;
      }

      resolve(result.slice(comma + 1));
    };

    reader.onerror = () => {
      reject(new Error("تعذر قراءة ملف الإيصال."));
    };

    reader.readAsDataURL(file);
  });
}

/* =========================================================
   معلومات النظام
   ========================================================= */

const paymentInfo = $("paymentInfo");

if (paymentInfo) {
  paymentInfo.addEventListener("click", () => {
    alert(
      "يمكن إرسال إيصال التحويل من النموذج المخصص. " +
      "سيظل المبلغ قيد المراجعة حتى يعتمده أمين المكتبة. " +
      "اعتماد دفعة موجبة يحجز كامل كميات الطلب وفق قواعد النظام."
    );
  });
}

const dataInfo = $("dataInfo");

if (dataInfo) {
  dataInfo.addEventListener("click", () => {
    alert(
      "تُحفظ الطلبات والمدفوعات وحركة المخزون في Google Sheets المرتبط بالنظام. " +
      "هذه الواجهة لا تستبدل ملف البيانات ولا تنشئ ملفًا جديدًا."
    );
  });
}

/* =========================================================
   تثبيت التطبيق PWA
   ========================================================= */

if (installBtn) {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    installBtn.classList.remove("hidden");
  });

  installBtn.addEventListener("click", async () => {
    if (!installPrompt) return;

    installPrompt.prompt();

    try {
      await installPrompt.userChoice;
    } catch (_) {
      // قد يرفض المستخدم التثبيت أو يغلق نافذته.
    }

    installPrompt = null;
    installBtn.classList.add("hidden");
  });

  window.addEventListener("appinstalled", () => {
    installBtn.classList.add("hidden");

    setMessage(
      testStatus,
      "تم تثبيت 4Print على الجهاز.",
      "status-ok"
    );
  });
}

/* =========================================================
   Service Worker
   ========================================================= */

if (
  "serviceWorker" in navigator &&
  location.protocol.startsWith("http")
) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register(
        "./service-worker.js"
      );

      setMessage(
        testStatus,
        "دعم التطبيق وتسجيل Service Worker متاحان.",
        "status-ok"
      );

    } catch (error) {
      setMessage(
        testStatus,
        "تعذر تسجيل Service Worker: " + error.message,
        "status-warn"
      );
    }
  });

} else {
  setMessage(
    testStatus,
    "التثبيت غير متاح في سياق التصفح الحالي.",
    "status-warn"
  );
}

/* =========================================================
   بدء التشغيل
   لا يتم إرسال حجز عند فتح الصفحة.
   ========================================================= */

loadProducts();
