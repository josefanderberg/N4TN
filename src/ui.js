function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

function formatNumber(value, step) {
  const decimals = step >= 1 ? 0 : Math.min(3, String(step).split('.')[1]?.length ?? 2);
  return Number(value).toFixed(decimals);
}

/**
 * Bygger kontrollpanelen från en deklarativ lista.
 * Alla värden skrivs direkt till `params`; `onChange(key)` anropas efter varje ändring.
 */
export function buildPanel(root, sections, params, defaults, onChange) {
  const bindings = [];

  const emit = (key) => {
    onChange(key);
    refresh();
  };

  function rangeRow(item) {
    const { key, label, min, max, step = 0.01 } = item;
    const output = el('output');
    const input = el('input', { type: 'range', min, max, step });
    input.addEventListener('input', () => {
      params[key] = parseFloat(input.value);
      output.textContent = formatNumber(params[key], step);
      emit(key);
    });
    // Dubbelklick återställer till standardvärdet.
    input.addEventListener('dblclick', () => {
      params[key] = defaults[key];
      emit(key);
    });
    const row = el('label', { class: 'row row-range', title: 'Dubbelklicka för att återställa' },
      el('span', { class: 'row-head' }, el('span', {}, label), output),
      input,
    );
    bindings.push({ item, row, sync: () => {
      input.value = params[key];
      output.textContent = formatNumber(params[key], step);
    } });
    return row;
  }

  function checkboxRow(item) {
    const { key, label } = item;
    const input = el('input', { type: 'checkbox' });
    input.addEventListener('change', () => {
      params[key] = input.checked;
      emit(key);
    });
    const row = el('label', { class: 'row row-check' }, input, el('span', {}, label));
    bindings.push({ item, row, input, sync: () => { input.checked = !!params[key]; } });
    return row;
  }

  function selectRow(item) {
    const { key, label, options } = item;
    const select = el('select', {},
      ...options.map(([value, text], i) => el('option', { value: i }, text)));
    select.addEventListener('change', () => {
      params[key] = options[select.selectedIndex][0];
      emit(key);
    });
    const row = el('label', { class: 'row row-select' }, el('span', {}, label), select);
    bindings.push({ item, row, input: select, sync: () => {
      const index = options.findIndex(([value]) => value === params[key]);
      select.selectedIndex = Math.max(0, index);
    } });
    return row;
  }

  function numberRow(item) {
    const { key, label, min, max, step = 1 } = item;
    const input = el('input', { type: 'number', min, max, step });
    const commit = () => {
      const raw = Math.round(parseFloat(input.value) / step) * step;
      const value = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : defaults[key];
      params[key] = value;
      input.value = value;
      emit(key);
    };
    input.addEventListener('change', commit);
    const row = el('label', { class: 'row row-select' }, el('span', {}, label), input);
    bindings.push({ item, row, input, sync: () => { if (document.activeElement !== input) input.value = params[key]; } });
    return row;
  }

  function colorRow(item) {
    const { key, label } = item;
    const input = el('input', { type: 'color' });
    input.addEventListener('input', () => {
      params[key] = input.value;
      emit(key);
    });
    const row = el('label', { class: 'row row-select' }, el('span', {}, label), input);
    bindings.push({ item, row, input, sync: () => { input.value = params[key]; } });
    return row;
  }

  function buttonsRow(item) {
    const row = el('div', { class: 'row row-buttons' },
      ...item.buttons.map((b) => {
        const button = el('button', {
          type: 'button',
          id: b.id,
          class: b.primary ? 'btn btn-primary' : 'btn',
        }, b.label);
        button.addEventListener('click', b.action);
        return button;
      }));
    bindings.push({ item, row, sync: () => {} });
    return row;
  }

  // Egen markup för det som inte passar som reglage, t.ex. sparade inställningar.
  function customRow(item) {
    const row = el('div', { class: 'row' });
    const api = item.render(row) || {};
    bindings.push({ item, row, sync: api.sync ?? (() => {}) });
    return row;
  }

  function tabsRow(item) {
    const buttons = item.tabs.map(([value, label]) => {
      const button = el('button', { type: 'button', class: 'tab' }, label);
      button.addEventListener('click', () => {
        item.set(value);
        refresh();
      });
      return [value, button];
    });
    const row = el('div', { class: 'row row-tabs' }, ...buttons.map(([, b]) => b));
    bindings.push({ item, row, sync: () => {
      const active = item.get();
      for (const [value, button] of buttons) button.classList.toggle('is-active', value === active);
    } });
    return row;
  }

  function noteRow(item) {
    const row = el('p', { class: 'row row-note', id: item.id });
    row.textContent = item.text ?? '';
    bindings.push({ item, row, sync: () => {} });
    return row;
  }

  const builders = {
    range: rangeRow,
    checkbox: checkboxRow,
    select: selectRow,
    number: numberRow,
    color: colorRow,
    buttons: buttonsRow,
    note: noteRow,
    custom: customRow,
    tabs: tabsRow,
  };

  for (const section of sections) {
    // Alla avsnitt är hopfällda från start; det ger överblick i stället för en vägg av reglage.
    const details = el('details', { class: 'sec', open: section.open === true });
    if (section.accent) details.style.setProperty('--sec-accent', section.accent);
    details.append(el('summary', {}, el('span', { class: 'sec-title' }, section.title)));
    const body = el('div', { class: 'sec-body' });
    if (section.hint) body.append(el('p', { class: 'sec-hint' }, section.hint));
    for (const item of section.items) body.append(builders[item.type](item));
    details.append(body);
    root.append(details);
  }

  let locked = false;

  function refresh() {
    for (const b of bindings) {
      const visible = b.item.visible ? b.item.visible(params) : true;
      b.row.hidden = !visible;
      const disabled = locked || (b.item.disabled ? b.item.disabled(params) : false);
      b.row.classList.toggle('is-disabled', disabled);
      for (const control of b.row.querySelectorAll('input, select, button')) {
        control.disabled = disabled;
      }
      // Sist, så att egna kontroller kan styra sitt eget läge utan att skrivas över.
      b.sync(disabled);
    }
  }

  refresh();

  return {
    refresh,
    setLocked(value) {
      locked = value;
      refresh();
    },
  };
}
