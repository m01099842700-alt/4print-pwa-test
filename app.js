
"use strict";

// ========================================
// إعدادات منصة 4Print
// ========================================

let installPrompt = null;
let isSubmitting = false;

const API_URL = "https://4print-api.m01099842700.workers.dev/";

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

let products = [];
const quantities = Object.create(null);

const PENDING_ORDER_KEY = "4print_pending_order_v1";

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
      throw new Error("بيانات الحجز المحفوظة غير مكتملة.");
    }

    return pending;
  } catch (error) {
    console.error("تعذر قراءة الحجز المحفوظ:", error);
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
    "تعذر إنشاء مفتاح آمن للحجز. افتح التطبيق عبر رابط HTTPS."
  );
}

function savePendingOrder(pending) {
  // يجب حفظ الطلب قبل إرساله إلى الخادم.
  // إذا فشل الحفظ، لا نرسل الطلب.
  localStorage.setItem(
    PENDING_ORDER_KEY,
    JSON.stringify(pending)
  );
}

function clearPendingOrder(idempotencyKey) {
  const pending = getPendingOrder();

  // لا نحذف إلا المحاولة التي تأكد نجاحها.
  if (
    pending &&
    pending.idempotencyKey === idempotencyKey
  ) {
    localStorage.removeItem(PENDING_ORDER_KEY);
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
    quantities[item.code] = Number(item.quantity) || 0;
  });

  return true;
}
// ========================================
// تنسيق الأسعار
// ========================================

function formatMoney(value) {
  return Number(value || 0).toLocaleString("ar-EG", {
    maximumFractionDigits: 2
  });
}

// ========================================
// تحديث ملخص الحجز
// ========================================

function updateSummary() {
  let count = 0;
  let total = 0;

  products.forEach(product => {
    const quantity = quantities[product.code] || 0;

    if (quantity > 0) {
      count++;
      total += quantity * Number(product.price || 0);
    }
  });

  if (selectedCount) {
    selectedCount.textContent = count;
  }

  if (orderTotal) {
    orderTotal.textContent = formatMoney(total);
  }
}

// ========================================
// عرض الخامات
// ========================================

function renderProducts() {
  if (!productsList) return;

  productsList.replaceChildren();

  if (!products.length) {
    if (productsStatus) {
      productsStatus.textContent =
        "لا توجد خامات لعرضها حاليًا.";
    }
    return;
  }

  products.forEach(product => {
    const card = document.createElement("article");
    card.className = "tile";
    card.style.marginBottom = "12px";

    const name = document.createElement("h3");
    name.textContent = product.name || "خامة دون اسم";

    const code = document.createElement("p");
    code.textContent =
      "كود الخامة: " + (product.code || "—");

    const price = document.createElement("p");
    price.textContent =
      "السعر: " + formatMoney(product.price) + " جنيه";

    const unit = document.createElement("p");
    unit.textContent =
      "الوحدة: " + (product.unit || "—");

    const stock = Math.max(
      0,
      Number(product.stock) || 0
    );

    const stockText = document.createElement("p");
    stockText.textContent =
      "الكمية المتاحة: " + stock;

    const controls = document.createElement("div");

    controls.style.display = "flex";
    controls.style.alignItems = "center";
    controls.style.gap = "12px";
    controls.style.flexWrap = "wrap";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "secondary";
    minus.textContent = "−";

    minus.setAttribute(
      "aria-label",
      "تقليل كمية " + product.name
    );

    const quantityText = document.createElement("strong");
    quantityText.textContent =
      quantities[product.code] || 0;

    quantityText.style.minWidth = "24px";
    quantityText.style.textAlign = "center";

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "secondary";
    plus.textContent = "+";

    plus.setAttribute(
      "aria-label",
      "زيادة كمية " + product.name
    );

    plus.disabled =
      stock <= 0 ||
      (quantities[product.code] || 0) >= stock;

    minus.disabled =
      !(quantities[product.code] > 0);

    minus.addEventListener("click", () => {
      quantities[product.code] = Math.max(
        0,
        (quantities[product.code] || 0) - 1
      );

      renderProducts();
      updateSummary();
    });

    plus.addEventListener("click", () => {
      const current =
        quantities[product.code] || 0;

      if (current < stock) {
        quantities[product.code] = current + 1;

        renderProducts();
        updateSummary();
      }
    });

    controls.append(minus, quantityText, plus);

    card.append(
      name,
      code,
      price,
      unit,
      stockText,
      controls
    );

    productsList.appendChild(card);
  });

  if (productsStatus) {
    productsStatus.textContent =
      "تم تحميل " + products.length +
      " خامة بنجاح.";
  }
}

// ========================================
// تهيئة نموذج الحجز
// ========================================

function setBookingReady() {
  if (bookingStatus) {
    bookingStatus.textContent =
      "النظام جاهز. اختر الخامات وأدخل بياناتك لإرسال طلب الحجز.";
  }

  if (submitOrderBtn) {
    submitOrderBtn.disabled = false;
  }
}

function setBookingUnavailable(message) {
  if (bookingStatus) {
    bookingStatus.textContent = message;
  }

  if (submitOrderBtn) {
    submitOrderBtn.disabled = true;
  }
}

// ========================================
// تحميل الخامات من النظام الفعلي
// ========================================

async function loadProducts() {
  if (productsStatus) {
    productsStatus.textContent =
      "جارٍ تحميل الخامات...";
  }

  if (connectionNotice) {
    connectionNotice.textContent =
      "جارٍ الاتصال بنظام الخامات...";
  }

  if (submitOrderBtn) {
    submitOrderBtn.disabled = true;
  }

  try {
    const response = await fetch(API_URL, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        "رمز الاستجابة " + response.status
      );
    }

    const data = await response.json();

    if (
      !data ||
      data.success !== true ||
      !Array.isArray(data.products)
    ) {
      throw new Error(
        data?.error ||
        "استجابة غير صحيحة من النظام."
      );
    }

products = data.products;

const hasPendingOrder = restorePendingOrder();

window.fourPrintProducts = products;

renderProducts();
updateSummary();
setBookingReady();

if (hasPendingOrder && bookingStatus) {
  bookingStatus.textContent =
    "يوجد حجز سابق لم تُحسم نتيجته بعد. عند الإرسال مجددًا سيُعاد إرسال الحجز المحفوظ نفسه، ولن تُرسل بيانات حجز جديد.";
}
// ========================================
// إرسال طلب الحجز
// ========================================

if (bookingForm) {
  bookingForm.addEventListener("submit", async function(event) {
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

    // إذا كانت هناك محاولة سابقة غير محسومة،
    // نعيد إرسال بياناتها ومفتاحها نفسيهما.
    if (pending) {
      const retry = confirm(
        "توجد محاولة حجز سابقة لم تُحسم نتيجتها.\n\n" +
        "سيعيد النظام إرسال الحجز السابق نفسه، " +
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
          quantity: quantities[product.code]
        }));

      if (!name || !phone) {
        if (bookingStatus) {
          bookingStatus.textContent =
            "يرجى إدخال الاسم الرباعي ورقم الهاتف.";
        }
        return;
      }

      if (!items.length) {
        if (bookingStatus) {
          bookingStatus.textContent =
            "يرجى اختيار خامة واحدة على الأقل.";
        }
        return;
      }

      if (!confirm(
        "هل تريد إرسال طلب الحجز؟ تأكد من الاسم والخامات والكميات قبل المتابعة."
      )) {
        return;
      }

      const idempotencyKey = createIdempotencyKey();

      payload = {
        name: name,
        phone: phone,
        items: items,
        idempotencyKey: idempotencyKey
      };

      pending = {
        idempotencyKey: idempotencyKey,
        payload: payload
      };

      try {
        // لا نرسل الطلب قبل حفظه محليًا.
        savePendingOrder(pending);
      } catch (error) {
        console.error("تعذر حفظ الحجز محليًا:", error);

        if (bookingStatus) {
          bookingStatus.textContent =
            "تعذر حفظ بيانات الحجز بأمان على هذا الجهاز؛ " +
            "لم يتم إرسال الطلب. تحقق من إعدادات المتصفح ومساحة التخزين.";
        }
        return;
      }
    }

    isSubmitting = true;

    if (submitOrderBtn) {
      submitOrderBtn.disabled = true;
      submitOrderBtn.textContent = "جارٍ إرسال الطلب...";
    }

    if (bookingStatus) {
      bookingStatus.textContent =
        "جارٍ إرسال الحجز والتحقق من نتيجته. يرجى الانتظار.";
    }

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (
        !response.ok ||
        !result ||
        result.success !== true
      ) {
        throw new Error(
          result?.error ||
          result?.message ||
          "لم يؤكد النظام تسجيل الطلب."
        );
      }

      // وصل تأكيد نجاح من الخادم؛ يمكن إزالة المحاولة المحفوظة.
      clearPendingOrder(pending.idempotencyKey);

      if (bookingStatus) {
        bookingStatus.textContent =
          "تم تأكيد الحجز بنجاح. رقم الطلب: " +
          result.orderId +
          " — الإجمالي: " +
          formatMoney(result.total) +
          " جنيه." +
          (result.duplicate
            ? " تم العثور على الحجز السابق ولم يُنشأ حجز مكرر."
            : " احتفظ برقم الطلب.");
      }

      bookingForm.reset();

      Object.keys(quantities).forEach(code => {
        quantities[code] = 0;
      });

      renderProducts();
      updateSummary();

      // تحديث المخزون من الخادم بعد نجاح الحجز.
      await loadProducts();

    } catch (error) {
      console.error("نتيجة إرسال طلب 4Print:", error);

      if (bookingStatus) {
        bookingStatus.textContent =
          "لم نتمكن من التأكد من نتيجة الحجز. " +
          "احتفظ بالصفحة ولا تحذف بيانات المتصفح. " +
          "يمكنك إعادة المحاولة لإرسال الطلب المحفوظ نفسه. " +
          "التفاصيل: " + error.message;
      }

      // لا نحذف المفتاح هنا؛ فقد يكون الخادم سجل الطلب بالفعل.

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
// تثبيت التطبيق على الجهاز
// ========================================

if (
  "serviceWorker" in navigator &&
  location.protocol.startsWith("http")
) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register(
        "./service-worker.js"
      );

      if (testStatus) {
        testStatus.textContent =
          "تم تسجيل Service Worker. جارٍ تحميل الخامات...";
      }

    } catch (error) {
      if (testStatus) {
        testStatus.textContent =
          "تعذر تسجيل Service Worker: " +
          error.message;
      }

      console.error(
        "خطأ تسجيل Service Worker:",
        error
      );
    }

    await loadProducts();
  });

} else {
  if (testStatus) {
    testStatus.textContent =
      "افتح الصفحة من رابط HTTPS.";
  }

  loadProducts();
}

if (installBtn) {
  window.addEventListener(
    "beforeinstallprompt",
    event => {
      event.preventDefault();
      installPrompt = event;
      installBtn.classList.remove("hidden");
    }
  );

  installBtn.addEventListener(
    "click",
    async () => {
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
    }
  );
}

// ========================================
// معلومات سياسة السداد والاستلام
// ========================================

if (paymentInfo) {
  paymentInfo.addEventListener("click", () => {
    alert(
      "أي سداد موجب بعد اعتماده يحجز الكمية كاملة، والاستلام لا يُؤكّد إلا بعد اعتماد كامل المبلغ."
    );
  });
}

if (dataInfo) {
  dataInfo.addEventListener("click", () => {
    alert(
      "تُحمّل الخامات من النظام الفعلي. لا يُسجّل الحجز بمجرد اختيار الخامات؛ يجب إرسال الطلب وتلقي تأكيد من النظام."
    );
  });
}
