// modules/tagControl.js

import { getCurrentIndex, getFileNote, setFileNote } from './fileState.js';

export function initTagControl() {
  const toggleTagModeBtn = document.getElementById('toggleTagModeBtn');
  const tagPanel = document.getElementById('tag-panel');

  const editTagsBtn = document.createElement('button');
  editTagsBtn.id = 'editTagsBtn';
  editTagsBtn.textContent = 'Edit Tags';
  editTagsBtn.className = 'flat-icon-button';

  const tagButtons = [];
  const defaultTags = [
    'JP', 'LP', 'CP', 'KP', 'LBB', 'GBB', 'CN', 'LYB',
    'HLB', 'ALB', 'CHB', 'IHB', 'LHB',
    'GBW', 'LBW', 'ABW',
    'HM', 'RBFM', 'CM', 'WM',
    'BTB', 'WFTB'
  ];

  defaultTags.forEach(tag => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'tag-button';
    inp.value = tag;
    inp.readOnly = true;
    inp.addEventListener('keydown', (e) => {
      if (e.key === ',') {
        e.preventDefault();
        alert('Commas are not allowed in tag names.');
      }
    });
    inp.addEventListener('input', (e) => {
      if (e.target.value.includes(',')) {
        e.target.value = e.target.value.replace(/,/g, '');
        alert('Commas are not allowed in tag names.');
      }
    });
    inp.addEventListener('click', () => handleTagClick(inp));
    tagPanel.appendChild(inp);
    tagButtons.push(inp);
  });
  tagPanel.appendChild(editTagsBtn);

  let wasSidebarEdit = false;
  let tagEditing = false;

  function updateTagButtonStates() {
    const idx = getCurrentIndex();
    const note = idx >= 0 ? getFileNote(idx) : '';
    const tags = note.split(',').map(t => t.trim()).filter(t => t);
    tagButtons.forEach(btn => {
      if (tags.includes(btn.value.trim())) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function handleTagClick(btn) {
    if (!btn.readOnly) return;
    const idx = getCurrentIndex();
    if (idx < 0) return;
    const tag = btn.value.trim();
    let note = getFileNote(idx);
    const tags = note ? note.split(',').map(t => t.trim()).filter(t => t) : [];
    const pos = tags.indexOf(tag);
    if (pos >= 0) {
      tags.splice(pos, 1);
      btn.classList.remove('active');
    } else {
      tags.push(tag);
      btn.classList.add('active');
    }
    const newNote = tags.join(', ');
    setFileNote(idx, newNote);
    const listItems = document.querySelectorAll('#fileList li');
    if (idx >= 0 && idx < listItems.length) {
      const input = listItems[idx].querySelector('.file-note-input');
      if (input) input.value = newNote;
    }
  }

  editTagsBtn.addEventListener('click', () => {
    tagEditing = !tagEditing;
    if (tagEditing) {
      editTagsBtn.textContent = 'Confirm';
      editTagsBtn.classList.add('editing-mode');
      tagButtons.forEach(btn => {
        btn.readOnly = false;
        btn.classList.add('editing');
      });
    } else {
      editTagsBtn.textContent = 'Edit Tags';
      editTagsBtn.classList.remove('editing-mode');
      tagButtons.forEach(btn => {
        btn.readOnly = true;
        btn.classList.remove('editing');
      });
      updateTagButtonStates();
    }
  });

  function enterTagMode() {
    document.body.classList.add('tag-mode-active');
    toggleTagModeBtn.classList.add('tag-active');
    wasSidebarEdit = document.getElementById('sidebar').classList.contains('edit-mode');
    if (!wasSidebarEdit) {
      document.getElementById('toggleEditBtn').click();
    }
    updateTagButtonStates();
  }

  function exitTagMode() {
    document.body.classList.remove('tag-mode-active');
    toggleTagModeBtn.classList.remove('tag-active');
    if (!wasSidebarEdit && document.getElementById('sidebar').classList.contains('edit-mode')) {
      document.getElementById('toggleEditBtn').click();
    }
  }

  toggleTagModeBtn.addEventListener('click', () => {
    if (document.body.classList.contains('tag-mode-active')) {
      exitTagMode();
    } else {
      enterTagMode();
    }
  });

  document.addEventListener('file-loaded', updateTagButtonStates);

  return { updateTagButtonStates };
}

