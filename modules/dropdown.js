// modules/dropdown.js

export class Dropdown {
  constructor(button, items = [], { onChange } = {}) {
    this.button = button;
    this.items = items;
    this.onChange = onChange;
    this.menu = this._createMenu();
    this.isOpen = false;
    this.selectedIndex = -1;
    this._bindButton();
  }

  _createMenu() {
    const menu = document.createElement('div');
    menu.className = 'dropdown-menu';
    menu.tabIndex = -1;
    this.items.forEach((item, index) => {
      const option = document.createElement('div');
      option.className = 'dropdown-item';
      option.textContent = item.label ?? item;
      option.dataset.index = index;
      option.addEventListener('click', () => {
        this.select(index);
        this.close();
      });
      menu.appendChild(option);
    });
    document.body.appendChild(menu);
    return menu;
  }

  _bindButton() {
    this.button.addEventListener('click', (e) => {
      if (this.button.disabled) return;
      e.stopPropagation();
      this.toggle();
    });
    this.button.addEventListener('keydown', (e) => {
      if (this.button.disabled) return;
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.open();
      }
    });
  }

  _bindDocument() {
    this._docHandler = (e) => {
      if (!this.menu.contains(e.target) && e.target !== this.button) {
        this.close();
      }
    };
    document.addEventListener('mousedown', this._docHandler);
    document.addEventListener('touchstart', this._docHandler);
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') {
        this.close();
      } else if (e.key === 'ArrowDown') {
        this._move(1);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        this._move(-1);
        e.preventDefault();
      } else if (e.key === 'Enter') {
        if (this.highlightedIndex != null) {
          this.select(this.highlightedIndex);
          this.close();
        }
      }
    });
  }

  _unbindDocument() {
    document.removeEventListener('mousedown', this._docHandler);
    document.removeEventListener('touchstart', this._docHandler);
  }

  _move(dir) {
    const items = Array.from(this.menu.querySelectorAll('.dropdown-item'));
    if (items.length === 0) return;
    if (this.highlightedIndex == null) {
      this.highlightedIndex = 0;
    } else {
      this.highlightedIndex = (this.highlightedIndex + dir + items.length) % items.length;
    }
    items.forEach((el, idx) => {
      el.classList.toggle('highlighted', idx === this.highlightedIndex);
    });
    items[this.highlightedIndex].scrollIntoView({ block: 'nearest' });
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    const rect = this.button.getBoundingClientRect();
    this.menu.style.minWidth = rect.width + 'px';
    this.menu.style.left = rect.left + window.scrollX + 'px';
    this.menu.style.top = rect.bottom + window.scrollY + 'px';
    this.menu.style.display = 'block';
    this.highlightedIndex = this.selectedIndex;
    const items = Array.from(this.menu.querySelectorAll('.dropdown-item'));
    items.forEach((el, idx) => {
      el.classList.toggle('selected', idx === this.selectedIndex);
    });
    this._bindDocument();
    this.menu.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.menu.style.display = 'none';
    this._unbindDocument();
    this.button.focus();
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  select(index) {
    this.selectedIndex = index;
    const value = this.items[index];
    const label = value.label ?? value;
    this.button.textContent = label;
    const items = Array.from(this.menu.querySelectorAll('.dropdown-item'));
    items.forEach((el, idx) => {
      el.classList.toggle('selected', idx === index);
    });
    if (this.onChange) this.onChange(value, index);
  }
}

export function initDropdown(buttonId, items, options) {
  const btn = typeof buttonId === 'string' ? document.getElementById(buttonId) : buttonId;
  return new Dropdown(btn, items, options);
}

