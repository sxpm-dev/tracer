const filter = document.querySelector('#filter-guides');
const navigation = document.querySelector('#site-navigation');
const empty = document.querySelector('#filter-empty');
const filterBox = document.querySelector('.sx-filter');

// Without JavaScript all navigation remains available; hide only this enhancement.
if (filter && navigation && empty && filterBox) {
  filterBox.hidden = false;
  filter.addEventListener('input', () => {
    const query = filter.value.trim().toLocaleLowerCase();
    let matches = 0;
    for (const group of navigation.querySelectorAll('[data-nav-group]')) {
      let visible = 0;
      for (const item of group.querySelectorAll('li')) {
        const match = item.textContent.toLocaleLowerCase().includes(query);
        item.hidden = !match;
        if (match) visible++;
      }
      group.hidden = visible === 0;
      matches += visible;
    }
    empty.hidden = matches > 0;
  });
}

const panel = document.querySelector('.sx-navigation-panel');
if (panel) {
  const mobile = matchMedia('(max-width: 760px)');
  const sync = () => { panel.open = !mobile.matches; };
  sync();
  mobile.addEventListener('change', sync);
}


for (const group of document.querySelectorAll('[data-examples]')) {
  const tabs = group.querySelector('[data-example-tabs]');
  const buttons = [...tabs.querySelectorAll('button')];
  const panels = [...group.querySelectorAll('[data-example-panel]')];
  function select(index, focus = false) {
    buttons.forEach((button, current) => {
      const selected = current === index;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      panels[current].hidden = !selected;
    });
    if (focus) buttons[index].focus();
  }
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Instrumentation examples');
  buttons.forEach((button, index) => {
    button.setAttribute('role', 'tab');
    panels[index].setAttribute('role', 'tabpanel');
    panels[index].setAttribute('aria-labelledby', button.id);
    panels[index].tabIndex = 0;
    button.addEventListener('click', () => select(index));
    button.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      if (next !== undefined) { event.preventDefault(); select(next, true); }
    });
  });
  group.dataset.enhanced = 'true';
  select(0);
  tabs.hidden = false;
}
