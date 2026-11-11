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
