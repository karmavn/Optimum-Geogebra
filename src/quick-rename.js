/**
 * Module xử lý tính năng Đổi tên nhanh (Quick Rename) cho GeoGebra
 * Tối ưu: Pooled DOM chips, event delegation, GPU translate3d, zero timer leak
 */
function initQuickRename(ggbApi) {
  let activeTarget = null;
  let lastPointClickTime = 0;
  let deselectTimer = null;
  let isOpen = false;
  let hasError = false;

  // 1. Tạo DOM Elements một lần duy nhất (Cache DOM)
  const popup = document.createElement('div');
  popup.className = 'quick-rename-popup';
  popup.innerHTML = `
    <div class="quick-rename-header">
      <span class="quick-rename-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="5"></circle>
        </svg>
        <span id="qr-badge-text">ĐIỂM</span>
      </span>
      <span class="quick-rename-hint">Tên hiện tại: <strong id="qr-current-name">A</strong></span>
    </div>
    <div class="quick-rename-input-wrap">
      <input type="text" class="quick-rename-input" id="qr-input" maxlength="20" autocomplete="off" spellcheck="false" />
    </div>
    <div class="quick-rename-chips" id="qr-chips"></div>
    <div class="quick-rename-footer">
      <span>↵ Enter để lưu</span>
      <span>Esc để hủy</span>
    </div>
  `;
  document.body.appendChild(popup);

  const input = popup.querySelector('#qr-input');
  const currentNameEl = popup.querySelector('#qr-current-name');
  const chipsContainer = popup.querySelector('#qr-chips');

  // Gợi ý các tên điểm hình học thông dụng
  const STANDARD_CHIPS = ["M", "H", "O", "I", "K", "A'", "B'", "C'"];
  const MAX_CHIPS = 6;

  // Pre-allocate 6 nút chip một lần duy nhất + event delegation
  const chipButtons = [];
  const initFrag = document.createDocumentFragment();
  for (let i = 0; i < MAX_CHIPS; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-btn';
    btn.hidden = true;
    chipButtons.push(btn);
    initFrag.appendChild(btn);
  }
  chipsContainer.appendChild(initFrag);

  chipsContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-btn');
    if (!btn || btn.hidden) return;
    e.stopPropagation();
    applyRename(btn.dataset.name);
  });

  function updateChips(currentName) {
    const prime = currentName && !currentName.includes("'") ? `${currentName}'` : null;
    for (let i = 0; i < MAX_CHIPS; i++) {
      const candidate = prime
        ? (i === 0 ? prime : STANDARD_CHIPS[i - 1])
        : STANDARD_CHIPS[i];
      const btn = chipButtons[i];
      if (candidate && candidate !== currentName) {
        if (btn.textContent !== candidate) {
          btn.textContent = candidate;
          btn.dataset.name = candidate;
        }
        btn.hidden = false;
      } else {
        btn.hidden = true;
      }
    }
  }

  function clearError() {
    if (!hasError) return;
    hasError = false;
    input.classList.remove('is-error');
    input.removeAttribute('title');
  }

  function clearDeselectTimer() {
    if (deselectTimer !== null) {
      clearTimeout(deselectTimer);
      deselectTimer = null;
    }
  }

  // Chỉ xóa trạng thái lỗi khi thực sự đang có lỗi
  input.addEventListener('input', clearError);

  // 2. Lắng nghe tương tác từ GeoGebra Client Listener
  ggbApi.registerClientListener((event) => {
    if (!event) return;
    const type = event.type || event[0];
    const target = event.target || event[1];

    if (type === 'select') {
      clearDeselectTimer();
      activeTarget = target;
      if (activeTarget && ggbApi.getObjectType(activeTarget) === 'point') {
        lastPointClickTime = Date.now();
      }
    } else if (type === 'deselect') {
      clearDeselectTimer();
      // Giữ lại activeTarget trong 400ms để chuột phải vẫn kịp nhận diện
      deselectTimer = setTimeout(() => {
        deselectTimer = null;
        if (Date.now() - lastPointClickTime > 400) {
          activeTarget = null;
        }
      }, 400);
    }
  });

  // 3. Lắng nghe Click trực tiếp lên đối tượng
  if (typeof ggbApi.registerClickListener === 'function') {
    ggbApi.registerClickListener((objName) => {
      clearDeselectTimer();
      activeTarget = objName;
      if (ggbApi.getObjectType(objName) === 'point') {
        lastPointClickTime = Date.now();
      }
    });
  }

  // 4. Hiển thị Popup tại tọa độ con trỏ chuột (GPU translate3d)
  function showPopup(x, y, targetObj) {
    activeTarget = targetObj;
    currentNameEl.textContent = targetObj;
    input.value = targetObj;
    clearError();
    updateChips(targetObj);

    if (!isOpen) {
      isOpen = true;
      popup.classList.add('is-open');
      popup.style.display = 'block';
    }

    const popupWidth = popup.offsetWidth || 220;
    const popupHeight = popup.offsetHeight || 130;

    let posX = x + 10;
    let posY = y + 10;

    if (posX + popupWidth > window.innerWidth) {
      posX = x - popupWidth - 10;
    }
    if (posY + popupHeight > window.innerHeight) {
      posY = y - popupHeight - 10;
    }

    popup.style.transform = `translate3d(${Math.max(10, posX)}px, ${Math.max(10, posY)}px, 0)`;

    // Focus & select text ở frame kế tiếp
    requestAnimationFrame(() => {
      if (isOpen) {
        input.focus();
        input.select();
      }
    });
  }

  function hidePopup() {
    if (!isOpen) return;
    isOpen = false;
    popup.style.display = 'none';
    popup.classList.remove('is-open');
  }

  // Áp dụng đổi tên
  function applyRename(newName) {
    newName = (newName || input.value || '').trim();
    if (newName && activeTarget && newName !== activeTarget) {
      if (ggbApi.exists(newName)) {
        hasError = true;
        input.classList.add('is-error');
        input.title = `Tên "${newName}" đã tồn tại!`;
        return;
      }
      try {
        ggbApi.renameObject(activeTarget, newName);
      } catch (err) {
        console.error('Lỗi khi đổi tên:', err);
      }
    }
    hidePopup();
  }

  // 5. Bắt sự kiện chuột phải (Context Menu) ở phase Capturing
  window.addEventListener('contextmenu', (e) => {
    if (isOpen && popup.contains(e.target)) return;

    const isPointRecently = (Date.now() - lastPointClickTime) < 500;
    const targetObj = activeTarget;

    if (targetObj && ggbApi.exists(targetObj)) {
      const type = ggbApi.getObjectType(targetObj);
      if (type === 'point' || isPointRecently) {
        // CHẶN MENU CHUỘT PHẢI 3 CHẤM MẶC ĐỊNH CỦA GEOGEBRA
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // MỞ NGAY POPUP ĐỔI TÊN TỨC THÌ
        showPopup(e.clientX, e.clientY, targetObj);
        return false;
      }
    }
  }, true);

  // Phím tắt Enter / Escape
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      applyRename();
    } else if (e.key === 'Escape') {
      hidePopup();
    }
  });

  // Ẩn khi click ra ngoài (không đọc DOM style khi popup đóng)
  window.addEventListener('mousedown', (e) => {
    if (isOpen && !popup.contains(e.target)) {
      hidePopup();
    }
  });
}

window.initQuickRename = initQuickRename;
