// modules/messageBox.js

export function showMessageBox({
  message = '',
  title = '',
  confirmText = 'OK',
  cancelText = null,
  onConfirm,
  onCancel,
  width = 420
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
  content.textContent = message;
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
      onConfirm();
    } else if (result === 'cancel' && typeof onCancel === 'function') {
      onCancel();
    }
  }

  confirmBtn.addEventListener('click', () => close('confirm'));
  cancelBtn?.addEventListener('click', () => close('cancel'));
  closeBtn.addEventListener('click', () => close('close'));

  document.body.appendChild(popup);
}
