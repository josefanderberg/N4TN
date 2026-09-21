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
 * `random` (valfri) kopplar in slumpen: i väljarläget får varje reglage en
 * tärningsknapp som slår av och på om slumpen får röra just det reglaget.
 */
export function buildPanel(root, sections, params, defaults, onChange, random = null) {
  const bindings = [];
  const randButtons = [];

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
    // Ett litet streck märker ut standardvärdet, så man hittar tillbaka efter
    // en ändring. Läget kompenserar för att tummen (12 px) inte når kanterna.
    let slider = input;
    if (typeof defaults[key] === 'number') {
      const fraction = Math.min(1, Math.max(0, (defaults[key] - min) / (max - min)));
      const tick = el('span', {
        class: 'range-tick',
        style: `left: calc(${(fraction * 100).toFixed(2)}% + ${(6 - 12 * fraction).toFixed(2)}px)`,
      });
      slider = el('span', { class: 'range-wrap' }, tick, input);
    }
    const row = el('label', { class: 'row row-range', title: 'Dubbelklicka för att återställa' },
      el('span', { class: 'row-head' }, el('span', {}, label), output),
      slider,
    );
    bindings.push({ item, row, sync: () => {
      input.value = params[key];
      output.textContent = formatNumber(params[key], step);
    } });
    return row;
  }

  // Utan `key` kan rutan i stället styra ett eget tillstånd via get/set,
  // t.ex. slumpens väljarläge, som inte hör till bildens parametrar.
  function checkboxRow(item) {
    const { key, label } = item;
    const input = el('input', { type: 'checkbox' });
    input.addEventListener('change', () => {
      if (item.set) {
        item.set(input.checked);
        refresh();
        return;
      }
      params[key] = input.checked;
      emit(key);
    });
    const row = el('label', { class: 'row row-check' }, input, el('span', {}, label));
    bindings.push({ item, row, input, sync: () => {
      input.checked = item.get ? !!item.get() : !!params[key];
    } });
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
          class: ['btn', b.primary && 'btn-primary', item.small && 'btn-small'].filter(Boolean).join(' '),
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

  // En flik kan ha ett synlighetsvillkor som tredje fält; försvinner den aktiva
  // fliken glider valet tillbaka till den första som syns.
  function tabsRow(item) {
    const buttons = item.tabs.map(([value, label, visible]) => {
      const button = el('button', { type: 'button', class: 'tab' }, label);
      button.addEventListener('click', () => {
        item.set(value);
        refresh();
      });
      return { value, button, visible };
    });
    const row = el('div', { class: 'row row-tabs' }, ...buttons.map((b) => b.button));
    bindings.push({ item, row, sync: () => {
      const shown = buttons.filter((b) => !b.visible || b.visible(params));
      for (const b of buttons) b.button.hidden = !shown.includes(b);
      let active = item.get();
      if (shown.length && !shown.some((b) => b.value === active)) {
        active = shown[0].value;
        item.set(active);
      }
      for (const b of buttons) b.button.classList.toggle('is-active', b.value === active);
    } });
    return row;
  }

  // En liten vikbar rubrik: raderna under (med visible knutet till samma
  // tillstånd) fälls in och ut med ett tryck.
  function foldRow(item) {
    const button = el('button', { type: 'button', class: 'fold' });
    button.addEventListener('click', () => {
      item.set(!item.get());
      refresh();
    });
    const row = el('div', { class: 'row row-fold' }, button);
    bindings.push({ item, row, sync: () => {
      button.textContent = `${item.get() ? '▾' : '▸'} ${item.label}`;
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
    fold: foldRow,
  };

  // Tärningen intill etiketten: av och på för om slumpen får röra reglaget.
  // Syns bara i väljarläget, och släcks (utan att gråas av raden) när den är av.
  function attachRandom(row, item) {
    if (!random || !item.key || !random.eligible(item.key)) return;
    const button = el('button', {
      type: 'button',
      class: 'rand-btn',
      'aria-label': `Får ${item.label ?? item.key} slumpas?`,
      title: 'Får slumpen röra det här reglaget?',
    }, '🎲');
    button.addEventListener('click', (e) => {
      // Knappen sitter inne i en label; utan detta skulle klicket även slå på radens reglage.
      e.preventDefault();
      e.stopPropagation();
      random.set(item.key, !random.get(item.key));
      refresh();
    });
    (row.querySelector('span span') ?? row.querySelector('span') ?? row).append(button);
    randButtons.push({ key: item.key, button });
  }

  // Ett litet i intill etiketten fäller ut en förklaring under raden.
  function attachInfo(row, item) {
    if (!item.info) return;
    const button = el('button', {
      type: 'button',
      class: 'info-btn',
      'aria-label': `Vad gör ${item.label ?? 'det här'}?`,
    }, 'i');
    const text = el('p', { class: 'row-info', hidden: true }, item.info);
    button.addEventListener('click', (e) => {
      // Knappen sitter inne i en label; utan detta skulle klicket även slå på radens reglage.
      e.preventDefault();
      e.stopPropagation();
      text.hidden = !text.hidden;
      button.classList.toggle('is-open', !text.hidden);
    });
    (row.querySelector('span span') ?? row.querySelector('span') ?? row).append(button);
    row.append(text);
  }

  for (const section of sections) {
    // Alla avsnitt är hopfällda från start; det ger överblick i stället för en vägg av reglage.
    const details = el('details', { class: 'sec', open: section.open === true });
    if (section.accent) details.style.setProperty('--sec-accent', section.accent);
    details.append(el('summary', {}, el('span', { class: 'sec-title' }, section.title)));
    const body = el('div', { class: 'sec-body' });
    if (section.hint) body.append(el('p', { class: 'sec-hint' }, section.hint));
    for (const item of section.items) {
      const row = builders[item.type](item);
      // Rader som hör till en flik ovanför markeras, så gränsen mot resten syns.
      if (item.pane) row.classList.add('row-pane');
      attachRandom(row, item);
      attachInfo(row, item);
      body.append(row);
    }
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
      for (const control of b.row.querySelectorAll('input, select, button:not(.info-btn):not(.rand-btn)')) {
        control.disabled = disabled;
      }
      // Sist, så att egna kontroller kan styra sitt eget läge utan att skrivas över.
      b.sync(disabled);
    }
    const picking = !!random?.picking();
    for (const { key, button } of randButtons) {
      button.hidden = !picking;
      button.classList.toggle('is-off', !random.get(key));
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
