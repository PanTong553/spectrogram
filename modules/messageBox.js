// modules/messageBox.js

export function showMessageBox({
  message = '',
  title = '',
  confirmText = 'OK',
  cancelText = null,
  onConfirm,
  onCancel,
  width = 420,
  // new options for input field
  input = false,
  inputType = 'text', // 'text' | 'password'
  inputPlaceholder = '',
  inputValue = ''
} = {}) {
  const popup = document.createElement('div');
  popup.className = 'map-popup modal-popup';
  popup.style.width = `${width}px`;

  const dragBar = document.createElement('div');
  dragBar.className = 'popup-drag-bar';
  if (title) {
    const titleSpan = document.createElement('span');
    titleSpan.className = 'popup-title';
    titleSpan.textContent = title;
    dragBar.appendChild(titleSpan);
  }
  const closeBtn = document.createElement('button');
  closeBtn.className = 'popup-close-btn';
  closeBtn.title = 'Close';
  closeBtn.innerHTML = '&times;';
  dragBar.appendChild(closeBtn);
  popup.appendChild(dragBar);

  const content = document.createElement('div');
  content.className = 'message-box-content';
  // allow message + optional input field
  const msgNode = document.createElement('div');
  msgNode.textContent = message;
  content.appendChild(msgNode);

  let inputEl = null;
  if (input) {
    inputEl = document.createElement('input');
    inputEl.type = inputType || 'text';
    inputEl.placeholder = inputPlaceholder || '';
    inputEl.value = inputValue || '';
    inputEl.style.marginTop = '8px';
    inputEl.style.width = '100%';
    inputEl.style.boxSizing = 'border-box';
    inputEl.style.border = '1px solid #ccc';
    inputEl.style.borderRadius = '4px';
    inputEl.style.boxShadow = 'inset 0 1px 2px rgba(0, 0, 0, 0.05)';
    inputEl.style.padding = '4px 10px';
    // apply common input styling via existing CSS rules (input[type=text], input[type=password])
    content.appendChild(inputEl);
    setTimeout(() => { inputEl.focus(); }, 10);
  }
  popup.appendChild(content);

  const actions = document.createElement('div');
  actions.className = 'message-box-actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'flat-icon-button';
  confirmBtn.textContent = confirmText;
  actions.appendChild(confirmBtn);

  let cancelBtn = null;
  if (cancelText) {
    cancelBtn = document.createElement('button');
    cancelBtn.className = 'flat-icon-button';
    cancelBtn.textContent = cancelText;
    actions.appendChild(cancelBtn);
  }
  popup.appendChild(actions);

  function close(result) {
    popup.remove();
    if (result === 'confirm' && typeof onConfirm === 'function') {
      try {
        if (inputEl) onConfirm(inputEl.value);
        else onConfirm();
      } catch (e) {
        onConfirm();
      }
    } else if (result === 'cancel' && typeof onCancel === 'function') {
      onCancel();
    }
  }

  confirmBtn.addEventListener('click', () => close('confirm'));
  cancelBtn?.addEventListener('click', () => close('cancel'));
  closeBtn.addEventListener('click', () => close('close'));

  if (inputEl) {
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        close('confirm');
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close('cancel');
      }
    });
  }

  document.body.appendChild(popup);
}
