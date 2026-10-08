let serial = 0;

// Session-only visual inventory. Cards can be scrolled, but not used yet.
export class InventoryStrip {
  constructor(root) {
    this.root = root;
    root.classList.add('nest-inventory');
    const headingId = `inventory-heading-${++serial}`;
    root.setAttribute('aria-labelledby', headingId);
    const heading = document.createElement('div');
    heading.className = 'nest-inventory-heading';
    const title = document.createElement('strong');
    title.id = headingId;
    title.textContent = 'Collected cards';
    this.count = document.createElement('span');
    this.count.setAttribute('aria-live', 'polite');
    heading.append(title, this.count);
    this.list = document.createElement('ul');
    this.list.className = 'nest-inventory-cards';
    this.list.tabIndex = 0;
    this.list.setAttribute('aria-label', 'Collected item cards');
    root.replaceChildren(heading, this.list);
    this.update([]);
  }

  update(items = []) {
    this.count.textContent = String(items.length);
    this.list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'nest-inventory-empty';
      empty.textContent = 'No items collected yet.';
      this.list.append(empty);
      return;
    }
    for (const item of items) {
      const entry = document.createElement('li');
      entry.className = 'nest-inventory-item';
      if (item.image) {
        const image = document.createElement('img');
        image.src = item.image;
        image.alt = '';
        image.draggable = false;
        if (item.flipImage) image.style.transform = 'scaleX(-1)';
        entry.append(image);
      }
      const label = document.createElement('span');
      label.textContent = item.label ?? item.title ?? item.id ?? String(item);
      entry.append(label);
      this.list.append(entry);
    }
  }
}
