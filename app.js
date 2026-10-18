
"use strict";

// ========================================
// إعدادات منصة 4Print
// ========================================

let installPrompt = null;
let isSubmitting = false;
let isLookingUpOrder = false;
let isSubmittingProof = false;
let currentOrderStatus = null;

const API_URL = "https://4print-api.m01099842700.workers.dev/";
const PENDING_ORDER_KEY = "4print_pending_order_v1";
const LAST_ORDER_KEY = "4print_last_order_v1";
const MAX_PROOF_SIZE = 5 * 1024 * 1024;

const installBtn = document.getElementById("installBtn");
const testStatus = document.getElementById("testStatus");
const productsStatus = document.getElementById("productsStatus");
const productsList = document.getElementById("productsList");
const connectionNotice = document.getElementById("connectionNotice");

const selectedCount = document.getElementById("selectedCount");
const orderTotal = document.getElementById("orderTotal");

const bookingForm = document.getElementById("bookingForm");
const bookingStatus = document.getElementById("bookingStatus");
const submitOrderBtn = document.getElementById("submitOrderBtn");

const paymentInfo = document.getElementById("paymentInfo");
const dataInfo = document.getElementById("dataInfo");

const orderLookupForm = document.getElementById("orderLookupForm");
const lookupOrderBtn = document.getElementById("lookupOrderBtn");
const lookupOrderId = document.getElementById("lookupOrderId");
const lookupPhone = document.getElementById("lookupPhone");

const orderStatusCard = document.getElementById("orderStatusCard");
const statusOrderId = document.getElementById("statusOrderId");
const statusOrderState = document.getElementById("statusOrderState");
const statusTotal = document.getElementById("statusTotal");
const statusPaid = document.getElementById("statusPaid");
const statusPending = document.getElementById("statusPending");
const statusRemaining = document.getElementById("statusRemaining");
const statusPaymentState = document.getElementById("statusPaymentState");
const orderStatusMessage = document.getElementById("orderStatusMessage");

const proofForm = document.getElementById("proofForm");
const proofAmount = document.getElementById("proofAmount");
const proofFile = document.getElementById("proofFile");
const submitProofBtn = document.getElementById("submitProofBtn");
const proofStatus = document.getElementById("proofStatus");

let products = [];
const quantities = Object.create(null);

// ========================================
// طلبات محفوظة محليًا
// ========================================

function getPendingOrder() {
  try {
    const raw = localStorage.getItem(PENDING_ORDER_KEY);
    if (!raw) return null;

    const pending = JSON.parse(raw);

    if (
      !pending ||
      typeof pending.idempotencyKey !== "string" ||
      !pending.payload ||
      !Array.isArray(pending.payload.items)
    ) {
      return null;
    }

    return pending;
  } catch (error) {
    console.error("تعذر قراءة محاولة الحجز:", error);
    return null;
  }
}

function createIdempotencyKey() {
  if (
    window.crypto &&
    typeof window.crypto.randomUUID === "function"
  ) {
    return window.crypto.randomUUID().replace(/-/g, "");
  }

  if (window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);

    return Array.from(bytes)
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  throw new Error(
    "تعذر إنشاء مفتاح آمن. افتح التطبيق عبر رابط HTTPS."
  );
}

function savePendingOrder(pending) {
  localStorage.setItem(
    PENDING_ORDER_KEY,
    JSON.stringify(pending)
  );
}

function clearPendingOrder(idempotencyKey) {
  const pending = getPendingOrder();

  if (
    pending &&
    pending.idempotencyKey === idempotencyKey
  ) {
    localStorage.removeItem(PENDING_ORDER_KEY);
  }
}

function saveLastOrder(order) {
  // نحفظ معلومات مختصرة للرجوع إليها؛ لا نحفظ أي ملف إثبات هنا.
  localStorage.setItem(
    LAST_ORDER_KEY,
    JSON.stringify({
      orderId: String(order.orderId || ""),
      phone: String(order.phone || ""),
      total: Number(order.total || 0),
      savedAt: new Date().toISOString()
    })
  );
}

function getLastOrder() {
  try {
    const raw = localStorage.getItem(LAST_ORDER_KEY);
    if (!raw) return null;

    const order = JSON.parse(raw);

    if (!order || !order.orderId || !order.phone) {
      return null;
    }

    return order;
  } catch (error) {
    console.error("تعذر قراءة آخر طلب:", error);
    return null;
  }
}

function restoreLastOrder() {
  const order = getLastOrder();
  if (!order) return;

  if (lookupOrderId) {
    lookupOrderId.value = order.orderId;
  }

  if (lookupPhone) {
    lookupPhone.value = order.phone;
  }
}

function restorePendingOrder() {
  const pending = getPendingOrder();
  if (!pending) return false;

  const payload = pending.payload;
  const nameInput = document.getElementById("studentName");
  const phoneInput = document.getElementById("studentPhone");

  if (nameInput) nameInput.value = payload.name || "";
  if (phoneInput) phoneInput.value = payload.phone || "";

  Object.keys(quantities).forEach(code => {
    quantities[code] = 0;
  });

  payload.items.forEach(item => {
    if (item && item.code) {
      quantities[item.code] = Number(item.quantity) || 0;
    }
  });

  return true;
}

// ========================================
// أدوات عامة
// ========================================

function formatMoney(value) {
  return Number(value || 0).toLocaleString("ar-EG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function setText(element, value) {
  if (element) {
    element.textContent = value == null ? "" : String(value);
  }
}

function normalizePhoneForDisplay(value) {
  return String(value || "").replace(/\s+/g, "");
}

async function postJson(api, payload) {
  const response = await fetch(API_URL + "?api=" + encodeURIComponent(api), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error(
      "تعذر قراءة رد النظام. لا تعاود إرسال عملية غير مؤكدة قبل مراجعة حالتها."
    );
  }

  if (!response.ok || !result || result.success !== true) {
    throw new Error(
      result?.error || result?.message || "لم ينجح الطلب."
    );
  }

  return result;
}

// ========================================
// ملخص الاختيار
// ========================================

function updateSummary() {
  let count = 0;
  let total = 0;

  products.forEach(product => {
    const quantity = Number(quantities[product.code] || 0);

    if (quantity > 0) {
      count++;
      total += quantity * Number(product.price || 0);
    }
  });

  setText(selectedCount, count);
  setText(orderTotal, formatMoney(total));
}

// ========================================
// عرض الخامات
// ========================================

function renderProducts() {
  if (!productsList) return;

  productsList.replaceChildren();

  if (!products.length) {
    setText(productsStatus, "لا توجد خامات لعرضها حاليًا.");
    return;
  }

  products.forEach(product => {
    const card = document.createElement("article");
    card.className = "tile";
    card.style.marginBottom = "12px";

    const name = document.createElement("h3");
    name.textContent = product.name || "خامة دون اسم";

    const code = document.createElement("p");
    code.textContent = "كود الخامة: " + (product.code || "—");

    const price = document.createElement("p");
    price.textContent =
      "السعر: " + formatMoney(product.price) + " جنيه";

    const unit = document.createElement("p");
    unit.textContent = "الوحدة: " + (product.unit || "—");

    const stock = Math.max(0, Number(product.stock) || 0);

    const stockText = document.createElement("p");
    stockText.textContent = "الكمية المتاحة: " + stock;

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.alignItems = "center";
    controls.style.gap = "12px";
    controls.style.flexWrap = "wrap";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "secondary";
    minus.textContent = "−";
    minus.setAttribute("aria-label", "تقليل كمية " + product.name);

    const quantityText = document.createElement("strong");
    quantityText.textContent = quantities[product.code] || 0;
    quantityText.style.minWidth = "24px";
    quantityText.style.textAlign = "center";

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "secondary";
    plus.textContent = "+";
    plus.setAttribute("aria-label", "زيادة كمية " + product.name);

    plus.disabled =
      stock <= 0 ||
      (quantities[product.code] || 0) >= stock;

    minus.disabled = !(quantities[product.code] > 0);

    minus.addEventListener("click", () => {
      quantities[product.code] = Math.max(
        0,
        (quantities[product.code] || 0) - 1
      );

      renderProducts();
      updateSummary();
    });

    plus.addEventListener("click", () => {
      const current = quantities[product.code] || 0;

      if (current < stock) {
        quantities[product.code] = current + 1;
        renderProducts();
        updateSummary();
      }
    });

    controls.append(minus, quantityText, plus);
    card.append(name, code, price, unit, stockText, controls);
    productsList.appendChild(card);
  });

  setText(
    productsStatus,
    "تم تحميل " + products.length + " خامة بنجاح."
  );
}

// ========================================
// تحميل الخامات
// ========================================

function setBookingUnavailable(message) {
  setText(bookingStatus, message);
  if (submitOrderBtn) submitOrderBtn.disabled = true;
}

async function loadProducts() {
  setText(productsStatus, "جارٍ تحميل الخامات...");
  setText(connectionNotice, "جارٍ الاتصال بنظام الخامات...");

  if (submitOrderBtn) submitOrderBtn.disabled = true;

  try {
    const response = await fetch(API_URL, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("رمز الاستجابة " + response.status);
    }

    const data = await response.json();

    if (
      !data ||
      data.success !== true ||
      !Array.isArray(data.products)
    ) {
      throw new Error(data?.error || "استجابة الخامات غير صحيحة.");
    }

    products = data.products;
    window.fourPrintProducts = products;

    const hasPendingOrder = restorePendingOrder();

    renderProducts();
    updateSummary();

    if (submitOrderBtn) submitOrderBtn.disabled = false;

    if (hasPendingOrder) {
      setText(
        bookingStatus,
        "توجد محاولة حجز سابقة لم تُحسم نتيجتها. " +
        "إعادة المحاولة سترسل بيانات المحاولة نفسها."
      );
    } else {
      setText(
        bookingStatus,
        "النظام جاهز. اختر الخامات وأدخل بياناتك لإرسال طلب الحجز."
      );
    }

    setText(connectionNotice, "تم الاتصال بنظام الخامات بنجاح.");

  } catch (error) {
    console.error("خطأ تحميل الخامات:", error);
    setText(productsStatus, "تعذر تحميل الخامات.");
    setText(
      connectionNotice,
      "تعذر الاتصال بالنظام. حدّث الصفحة وحاول مرة أخرى."
    );

    setBookingUnavailable(
      "لم يتم تحميل الخامات. لن تتمكن من إرسال حجز حتى نجاح الاتصال."
    );
  }
}

// ========================================
// إرسال طلب الحجز
// ========================================

if (bookingForm) {
  bookingForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (isSubmitting) return;

    if (!products.length) {
      setBookingUnavailable(
        "الخامات غير محمّلة. حدّث الصفحة وحاول مرة أخرى."
      );
      return;
    }

    let pending = getPendingOrder();
    let payload;

    if (pending) {
      const retry = confirm(
        "توجد محاولة حجز سابقة لم تُحسم نتيجتها.\n\n" +
        "سيعيد النظام إرسال بيانات الحجز السابقة نفسها، " +
        "ولن يرسل الاختيارات الحالية كحجز جديد.\n\n" +
        "هل تريد إعادة المحاولة؟"
      );

      if (!retry) return;
      payload = pending.payload;

    } else {
      if (!bookingForm.reportValidity()) return;

      const name =
        document.getElementById("studentName")?.value.trim() || "";
      const phone =
        document.getElementById("studentPhone")?.value.trim() || "";

      const items = products
        .filter(product => (quantities[product.code] || 0) > 0)
        .map(product => ({
          code: product.code,
          quantity: Number(quantities[product.code])
        }));

      if (!name || !phone) {
        setText(bookingStatus, "يرجى إدخال الاسم الرباعي ورقم الهاتف.");
        return;
      }

      if (!items.length) {
        setText(bookingStatus, "يرجى اختيار خامة واحدة على الأقل.");
        return;
      }

      if (!confirm(
        "هل تريد إرسال طلب الحجز؟ تأكد من الاسم والخامات والكميات قبل المتابعة."
      )) {
        return;
      }

      let idempotencyKey;
      try {
        idempotencyKey = createIdempotencyKey();
      } catch (error) {
        setText(bookingStatus, error.message);
        return;
      }

      payload = {
        name,
        phone,
        items,
        idempotencyKey
      };

      pending = {
        idempotencyKey,
        payload
      };

      try {
        savePendingOrder(pending);
      } catch (error) {
        console.error("تعذر حفظ محاولة الحجز:", error);
        setText(
          bookingStatus,
          "تعذر حفظ محاولة الحجز على هذا الجهاز؛ لم يتم إرسال الطلب."
        );
        return;
      }
    }

    isSubmitting = true;

    if (submitOrderBtn) {
      submitOrderBtn.disabled = true;
      submitOrderBtn.textContent = "جارٍ إرسال الطلب...";
    }

    setText(
      bookingStatus,
      "جارٍ إرسال الحجز والتحقق من نتيجته. يرجى الانتظار."
    );

    try {
      const result = await postJson("order", payload);

      if (!result.orderId) {
        throw new Error(
          "لم يتضمن رد النظام رقم الطلب؛ احتفظ بمحاولة الحجز ولا تنشئ طلبًا جديدًا."
        );
      }

      // حفظ رقم الطلب والهاتف للرجوع إلى متابعة السداد.
      saveLastOrder({
        orderId: result.orderId,
        phone: payload.phone,
        total: result.total
      });

      clearPendingOrder(pending.idempotencyKey);

      bookingForm.reset();
      Object.keys(quantities).forEach(code => {
        quantities[code] = 0;
      });

      await loadProducts();

      setText(
        bookingStatus,
        "تم تأكيد الحجز بنجاح. رقم الطلب: " +
        result.orderId +
        " — الإجمالي: " +
        formatMoney(result.total) +
        " جنيه. احتفظ برقم الطلب، ويمكنك متابعة السداد أدناه."
      );

      restoreLastOrder();

      if (orderStatusCard) orderStatusCard.hidden = true;
      if (proofForm) proofForm.hidden = true;

      document.getElementById("orderFollowSection")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

    } catch (error) {
      console.error("نتيجة إرسال طلب 4Print:", error);

      setText(
        bookingStatus,
        "لم نتمكن من التأكد من نتيجة الحجز. لا تنشئ طلبًا جديدًا. " +
        "يمكنك إعادة المحاولة لإرسال المحاولة المحفوظة نفسها. " +
        "التفاصيل: " + error.message
      );

    } finally {
      isSubmitting = false;

      if (submitOrderBtn) {
        submitOrderBtn.textContent = "إرسال طلب الحجز";
        submitOrderBtn.disabled = products.length === 0;
      }
    }
  });
}

// ========================================
// الاستعلام الآمن عن حالة الطلب
// ========================================

function displayOrderStatus(result) {
  currentOrderStatus = result;

  setText(statusOrderId, result.orderId);
  setText(statusOrderState, result.status || "غير محددة");
  setText(statusTotal, formatMoney(result.total));
  setText(statusPaid, formatMoney(result.paid));
  setText(statusPending, formatMoney(result.pending));
  setText(statusRemaining, formatMoney(result.remaining));
  setText(statusPaymentState, result.paymentStatus || "غير محددة");

  if (orderStatusCard) orderStatusCard.hidden = false;

  const closed = ["ملغي", "مرفوض", "تم الاستلام"].includes(
    String(result.status || "").trim()
  );

  if (proofForm) {
    proofForm.hidden = closed;
  }

  if (proofAmount) {
    // المبلغ القابل للإرسال يخصم الدفعات المعلقة لتجنب تجاوز المتبقي.
    proofAmount.max = String(
      Math.max(0, Number(result.payableNow ?? result.remaining ?? 0))
    );
    proofAmount.value = "";
    proofAmount.placeholder =
      "المتاح للإرسال: " +
      formatMoney(result.payableNow ?? result.remaining ?? 0) +
      " جنيه";
  }

  if (closed) {
    setText(orderStatusMessage, "هذا الطلب مغلق ولا يمكن إرسال دفعة جديدة له.");
  } else if (Number(result.payableNow ?? result.remaining ?? 0) <= 0) {
    setText(
      orderStatusMessage,
      "لا يوجد مبلغ إضافي متاح لإرسال إثبات جديد حاليًا. راجع حالة الدفعات المعلقة."
    );
    if (proofForm) proofForm.hidden = true;
  } else {
    setText(
      orderStatusMessage,
      "يمكنك إرسال إثبات التحويل. سيظل بانتظار مراجعة أمين المكتبة."
    );
  }
}

if (orderLookupForm) {
  orderLookupForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (isLookingUpOrder) return;

    if (!orderLookupForm.reportValidity()) return;

    const orderId = lookupOrderId.value.trim();
    const phone = normalizePhoneForDisplay(lookupPhone.value);

    if (!orderId || !phone) return;

    isLookingUpOrder = true;
    if (lookupOrderBtn) {
      lookupOrderBtn.disabled = true;
      lookupOrderBtn.textContent = "جارٍ التحقق...";
    }

    if (orderStatusCard) orderStatusCard.hidden = true;
    if (proofForm) proofForm.hidden = true;
    setText(orderStatusMessage, "");

    try {
      const result = await postJson("status", {
        orderId,
        phone
      });

      displayOrderStatus(result);

    } catch (error) {
      setText(
        orderStatusMessage,
        "تعذر العثور على الطلب أو التحقق من بياناته. " +
        "راجع رقم الطلب ورقم الهاتف ثم حاول مجددًا."
      );

      if (orderStatusCard) orderStatusCard.hidden = false;
      console.error("خطأ استعلام الطلب:", error);

    } finally {
      isLookingUpOrder = false;

      if (lookupOrderBtn) {
        lookupOrderBtn.disabled = false;
        lookupOrderBtn.textContent = "عرض حالة الطلب";
      }
    }
  });
}

// ========================================
// إرسال إثبات التحويل الإلكتروني
// ========================================

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const comma = dataUrl.indexOf(",");

      if (comma < 0) {
        reject(new Error("تعذر قراءة الملف المختار."));
        return;
      }

      resolve(dataUrl.slice(comma + 1));
    };

    reader.onerror = () => {
      reject(new Error("حدث خطأ أثناء قراءة الملف."));
    };

    reader.readAsDataURL(file);
  });
}

function validateProofFile(file) {
  if (!file) {
    throw new Error("اختر ملف إثبات التحويل.");
  }

  if (file.size <= 0 || file.size > MAX_PROOF_SIZE) {
    throw new Error("يجب ألا يتجاوز حجم الملف 5 ميجابايت.");
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "application/pdf"
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error("نوع الملف غير مدعوم. اختر JPG أو PNG أو PDF.");
  }

  const name = String(file.name || "").toLowerCase();
  const extensionAllowed = /\.(jpg|jpeg|png|pdf)$/.test(name);

  if (!extensionAllowed) {
    throw new Error("امتداد الملف غير مسموح.");
  }
}

if (proofForm) {
  proofForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (isSubmittingProof) return;

    if (!currentOrderStatus) {
      setText(proofStatus, "استعلم عن الطلب أولًا.");
      return;
    }

    if (!proofForm.reportValidity()) return;

    const orderId = String(currentOrderStatus.orderId || "");
    const phone = normalizePhoneForDisplay(lookupPhone.value);
    const amount = Number(proofAmount.value);
    const file = proofFile.files && proofFile.files[0];

    if (!Number.isFinite(amount) || amount <= 0) {
      setText(proofStatus, "أدخل مبلغًا أكبر من صفر.");
      return;
    }

    const payableNow = Number(
      currentOrderStatus.payableNow ??
      currentOrderStatus.remaining ??
      0
    );

    if (amount > payableNow + 0.001) {
      setText(
        proofStatus,
        "المبلغ أكبر من المتاح حاليًا. حدّث حالة الطلب قبل الإرسال."
      );
      return;
    }

    try {
      validateProofFile(file);
    } catch (error) {
      setText(proofStatus, error.message);
      return;
    }

    const confirmed = confirm(
      "هل تريد إرسال إثبات التحويل بمبلغ " +
      formatMoney(amount) +
      " جنيه للطلب " +
      orderId +
      "؟\n\nسيظل الإثبات بانتظار مراجعة أمين المكتبة."
    );

    if (!confirmed) return;

    isSubmittingProof = true;

    if (submitProofBtn) {
      submitProofBtn.disabled = true;
      submitProofBtn.textContent = "جارٍ إرسال الإثبات...";
    }

    setText(
      proofStatus,
      "جارٍ إرسال الملف. لا تغلق الصفحة حتى تظهر نتيجة العملية."
    );

    try {
      const base64 = await fileToBase64(file);

      const result = await postJson("proof", {
        orderId,
        phone,
        amount,
        fileName: file.name,
        mimeType: file.type,
        base64
      });

      setText(
        proofStatus,
        result.message ||
        "تم إرسال الإثبات. سيظل بانتظار مراجعة أمين المكتبة."
      );

      proofForm.reset();

      // تحديث حالة الطلب من الخادم بعد إرسال الإثبات.
      // إذا تعذر الاستعلام، نظهر نجاح الإرسال دون افتراض الاعتماد.
      try {
        const refreshed = await postJson("status", {
          orderId,
          phone
        });
        displayOrderStatus(refreshed);
      } catch (refreshError) {
        console.warn("تعذر تحديث الحالة بعد الإرسال:", refreshError);
        setText(
          proofStatus,
          "تم إرسال الإثبات إلى النظام. لم يتم اعتماده تلقائيًا؛ " +
          "يمكنك تحديث حالة الطلب لاحقًا."
        );
      }

    } catch (error) {
      console.error("خطأ إرسال إثبات التحويل:", error);

      setText(
        proofStatus,
        "تعذر تأكيد إرسال الإثبات: " + error.message +
        " تحقق من حالة الطلب قبل إعادة الإرسال لتجنب تكرار الإثبات."
      );

    } finally {
      isSubmittingProof = false;

      if (submitProofBtn) {
        submitProofBtn.disabled = false;
        submitProofBtn.textContent = "إرسال إثبات التحويل";
      }
    }
  });
}

// ========================================
// تثبيت التطبيق وتسجيل Service Worker
// ========================================

if (
  "serviceWorker" in navigator &&
  location.protocol.startsWith("http")
) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./service-worker.js");

      setText(
        testStatus,
        "تم تسجيل Service Worker. جارٍ تحميل الخامات..."
      );
    } catch (error) {
      setText(
        testStatus,
        "تعذر تسجيل Service Worker: " + error.message
      );
      console.error("خطأ تسجيل Service Worker:", error);
    }

    await loadProducts();
  });
} else {
  setText(testStatus, "افتح الصفحة من رابط HTTPS.");
  loadProducts();
}

if (installBtn) {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    installBtn.classList.remove("hidden");
  });

  installBtn.addEventListener("click", async () => {
    if (!installPrompt) {
      alert(
        "افتح قائمة المتصفح واختر إضافة إلى الشاشة الرئيسية أو تثبيت التطبيق."
      );
      return;
    }

    installPrompt.prompt();
    await installPrompt.userChoice;

    installPrompt = null;
    installBtn.classList.add("hidden");
  });
}

// ========================================
// استعادة بيانات آخر طلب
// ========================================

restoreLastOrder();

// ========================================
// معلومات سياسة السداد والبيانات
// ========================================

if (paymentInfo) {
  paymentInfo.addEventListener("click", () => {
    alert(
      "أي دفعة موجبة معتمدة تكفي لحجز الكمية كاملة. " +
      "إثبات التحويل لا يُعتمد تلقائيًا، بل يراجعه أمين المكتبة. " +
      "ولا يتم تأكيد الاستلام إلا بعد اعتماد كامل المبلغ."
    );
  });
}

if (dataInfo) {
  dataInfo.addEventListener("click", () => {
    alert(
      "تُحفظ الطلبات والمدفوعات وحركة المخزون في Google Sheets الحالي. " +
      "يحتفظ المتصفح برقم آخر طلب لتسهيل المتابعة، ولا يخزن ملف إثبات التحويل."
    );
  });
}
