/**
 * Module xử lý tính năng Đổi tên nhanh (Quick Rename) cho GeoGebra
 * Tối ưu: Pooled DOM chips, event delegation, GPU translate3d, zero timer leak
 */
const STANDARD_CHIPS = ['M', 'H', 'O', 'I', 'K', "A'", "B'", "C'"];
const MAX_CHIPS = 6;
const POINT_RECENCY_MS = 600;

function computeSuggestionChips(currentName, existsFn, maxChips = MAX_CHIPS) {
  const result = [];
  const seen = new Set();
  const addIfEligible = (name) => {
    if (!name || name === currentName || seen.has(name)) return;
    if (typeof existsFn === 'function' && existsFn(name)) return;
    seen.add(name);
    result.push(name);
  };

  if (currentName && !currentName.includes("'")) {
    addIfEligible(`${currentName}'`);
  }
  for (const candidate of STANDARD_CHIPS) {
    if (result.length >= maxChips) break;
    addIfEligible(candidate);
  }
  return result.slice(0, maxChips);
}

let initialized = false;

function initQuickRename(ggbApi) {
  if (initialized || !ggbApi) return;
  initialized = true;

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
    <div class="quick-rename-error" id="qr-error" role="alert" hidden></div>
    <div class="quick-rename-chips" id="qr-chips"></div>
    <div class="quick-rename-footer">
      <span>↵ Enter để lưu</span>
      <span>Esc để hủy</span>
    </div>
  `;
  document.body.appendChild(popup);

  const input = popup.querySelector('#qr-input');
  const errorEl = popup.querySelector('#qr-error');
  const currentNameEl = popup.querySelector('#qr-current-name');
  const chipsContainer = popup.querySelector('#qr-chips');

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
    const chosen = btn.dataset.name;
    input.value = chosen;
    applyRename(chosen);
  });

  function updateChips(currentName) {
    const chips = computeSuggestionChips(
      currentName,
      (name) => typeof ggbApi.exists === 'function' && ggbApi.exists(name),
      MAX_CHIPS
    );
    for (let i = 0; i < MAX_CHIPS; i++) {
      const candidate = chips[i];
      const btn = chipButtons[i];
      if (candidate) {
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

  function showError(message) {
    hasError = true;
    input.classList.add('is-error');
    input.title = message;
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
  }

  function clearError() {
    if (!hasError) return;
    hasError = false;
    input.classList.remove('is-error');
    input.removeAttribute('title');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
  }

  function clearDeselectTimer() {
    if (deselectTimer !== null) {
      clearTimeout(deselectTimer);
      deselectTimer = null;
    }
  }

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

    requestAnimationFrame(() => {
      if (isOpen) {
        input.focus();
        input.select();
      }
    });
  }

  function hidePopup() {
    if (!isOpen) return false;
    isOpen = false;
    popup.style.display = 'none';
    popup.classList.remove('is-open');
    return true;
  }

  if (typeof window !== 'undefined') {
    window.dismissQuickRenamePopup = hidePopup;
  }

  // Áp dụng đổi tên
  function applyRename(newName) {
    newName = (newName !== undefined ? newName : input.value || '').trim();
    if (!newName || !activeTarget || newName === activeTarget) {
      hidePopup();
      return;
    }

    if (ggbApi.exists(newName)) {
      showError(`Tên "${newName}" đã tồn tại!`);
      return;
    }

    try {
      const ok = ggbApi.renameObject(activeTarget, newName);
      if (ok === false) {
        showError(`Tên "${newName}" không hợp lệ trong GeoGebra!`);
        return;
      }
    } catch (err) {
      console.error('Lỗi khi đổi tên:', err);
      showError(`Không thể đổi tên thành "${newName}"!`);
      return;
    }

    hidePopup();
  }

  // 5. Bắt sự kiện chuột phải (Context Menu) ở phase Capturing, chỉ trên canvas và đúng đối tượng điểm
  window.addEventListener('contextmenu', (e) => {
    if (isOpen && popup.contains(e.target)) return;
    if (!e.target || typeof e.target.closest !== 'function' || !e.target.closest('#ggb-container canvas')) {
      return;
    }

    const isPointRecently = (Date.now() - lastPointClickTime) < POINT_RECENCY_MS;
    const targetObj = activeTarget;

    if (targetObj && ggbApi.exists(targetObj)) {
      const type = ggbApi.getObjectType(targetObj);
      if (type === 'point' && isPointRecently) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
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

  // Ẩn khi click ra ngoài
  window.addEventListener('mousedown', (e) => {
    if (isOpen && !popup.contains(e.target)) {
      hidePopup();
    }
  });
}

if (typeof window !== 'undefined') {
  window.initQuickRename = initQuickRename;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initQuickRename, computeSuggestionChips };
}
