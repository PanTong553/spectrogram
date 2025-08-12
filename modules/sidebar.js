// modules/sidebar.js

import {
  getFileList,
  getCurrentIndex,
  getFileIconState,
  getFileNote,
  setFileNote,
  toggleFileIcon
} from './fileState.js';

export function initSidebar({ onFileSelected } = {}) {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('toggleSidebarBtn');
  const sidebarIcon = document.getElementById('sidebarIcon');
  const fileListUl = document.getElementById('fileList');
  const searchInput = document.getElementById('searchInput');
  const editBtn = document.getElementById('toggleEditBtn');
  const filePathSpan = document.getElementById('currentFilePath');
  const fileCount = document.getElementById('fileCount');

  let isEditMode = false;

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    const isCollapsed = sidebar.classList.contains('collapsed');
    toggleBtn.title = isCollapsed ? 'Open File List' : 'Collapse File List';
    const evt = new CustomEvent('sidebar-toggle', {
      bubbles: true,
      detail: { collapsed: isCollapsed }
    });
    sidebar.dispatchEvent(evt);
  });

  editBtn.addEventListener('click', () => {
    isEditMode = !isEditMode;
    sidebar.classList.toggle('edit-mode', isEditMode);
  });

  searchInput.addEventListener('input', () => {
    renderFileList(searchInput.value.trim().toLowerCase());
  });

  function renderFileList(filter = '', doScroll = true) {
    const list = getFileList();
    const currentIndex = getCurrentIndex();
    if (fileCount) {
      const countText = `(Total: ${list.length.toLocaleString()} files)`;
      fileCount.textContent = countText;
    }    
    let activeItem = null;
  
    fileListUl.innerHTML = '';
  
    list.forEach((file, index) => {
      if (filter && !file.name.toLowerCase().includes(filter)) return;

      const li = document.createElement('li');
      li.className = 'sidebar-item';
  
      const nameWithoutExt = file.name.replace(/\.wav$/i, '');

      const left = document.createElement('span');
      left.className = 'sidebar-left';
      
      const icon = document.createElement('i');
      icon.className = 'fa-regular fa-file-audio sidebar-file-icon';
      left.appendChild(icon);
  
      const textSpan = document.createElement('span');
      textSpan.className = 'fileNameText';
      textSpan.textContent = nameWithoutExt;
      left.appendChild(textSpan);
      
      li.appendChild(left);

      const rightContainer = document.createElement('span');
      rightContainer.className = 'sidebar-right';

      const flags = document.createElement('span');
      flags.className = 'sidebar-flags';

      const state = getFileIconState(index);

      const d = document.createElement('i');
      d.className = 'fa-solid fa-trash flag-icon';
      d.title = 'Mark as Trash (Delete)';
      const dActive = 'gray';
      d.style.color = state.trash ? dActive : '#ccc';
      d.addEventListener('mouseenter', () => {
        if (!state.trash) d.style.color = dActive;
      });
      d.addEventListener('mouseleave', () => {
        if (!state.trash) d.style.color = '#ccc';
      });
      d.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFileIcon(index, 'trash');
        renderFileList(filter, false);
      });
      flags.appendChild(d);

      const s = document.createElement('i');
      s.className = 'fa-solid fa-star flag-icon';
      s.title = 'Mark as Star ( * button)';
      const sActive = '#FFD700';
      s.style.color = state.star ? sActive : '#ccc';
      s.addEventListener('mouseenter', () => {
        if (!state.star) s.style.color = sActive;
      });
      s.addEventListener('mouseleave', () => {
        if (!state.star) s.style.color = '#ccc';
      });
      s.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFileIcon(index, 'star');
        renderFileList(filter, false);
      });
      flags.appendChild(s);

      const q = document.createElement('i');
      q.className = 'fa-solid fa-question flag-icon';
      q.title = 'Mark as Question ( ? button)';
      const qActive = 'red';
      q.style.color = state.question ? qActive : '#ccc';
      q.addEventListener('mouseenter', () => {
        if (!state.question) q.style.color = qActive;
      });
      q.addEventListener('mouseleave', () => {
        if (!state.question) q.style.color = '#ccc';
      });
      q.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFileIcon(index, 'question');
        renderFileList(filter, false);
      });
      flags.appendChild(q);

      rightContainer.appendChild(flags);

      const noteInput = document.createElement('input');
      noteInput.type = 'text';
      noteInput.className = 'file-note-input';
      noteInput.value = getFileNote(index);
      noteInput.addEventListener('click', (e) => e.stopPropagation());
      noteInput.addEventListener('input', (e) => {
        setFileNote(index, e.target.value);
      });
      rightContainer.appendChild(noteInput);

      li.appendChild(rightContainer);

      left.addEventListener('click', () => {
        if (typeof onFileSelected === 'function') {
          onFileSelected(index);
        }
      });
  
      if (index === currentIndex) {
        li.style.fontWeight = 'bold';
        li.style.color = '#007bff';
        activeItem = li;
      }
  
      fileListUl.appendChild(li);
    });
  
    // 等待瀏覽器渲染完成後執行 scroll (預設行為)
    if (activeItem && doScroll) {
      requestAnimationFrame(() => {
        activeItem.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
  }

  function updateCurrentPath(filePath) {
    const fileNameText = document.getElementById('fileNameText');
    fileNameText.textContent = filePath ? filePath : 'Upload wav file(s)';
  }
  
  return {
    refresh: (filePath, resetSearch = true) => {
      updateCurrentPath(filePath);
      if (resetSearch) {
        searchInput.value = '';
      }
      renderFileList(searchInput.value.trim().toLowerCase());
    }
  };
}
