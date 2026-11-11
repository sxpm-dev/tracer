import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchableSelect } from '../src/SearchableSelect';

afterEach(cleanup);
describe('searchable root picker', () => {
  const options = [
    { label: 'All roots', value: '' },
    ...Array.from({ length: 250 }, (_, id) => ({
      detail: `${id} rays`,
      label: `editor.Service.method${id}`,
      value: String(id),
    })),
  ];
  it('bounds the list, searches all options and selects with the keyboard', () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect
        label="Root call"
        onChange={onChange}
        options={options}
        value=""
      />,
    );
    const trigger = screen.getByRole('button', {
      name: 'Root call: All roots',
    });
    fireEvent.click(trigger);
    expect(screen.getAllByRole('option')).toHaveLength(100);
    expect(
      screen.getByRole('option', { name: 'All roots' }).className,
    ).not.toContain('is-active');
    const search = screen.getByRole('combobox', { name: 'Search root call' });
    fireEvent.change(search, { target: { value: 'METHOD249' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('249');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('handles empty searches, escape and outside dismissal', () => {
    render(
      <SearchableSelect
        label="Root call"
        onChange={vi.fn()}
        options={options}
        value=""
      />,
    );
    const trigger = screen.getByRole('button', {
      name: 'Root call: All roots',
    });
    fireEvent.click(trigger);
    const search = screen.getByRole('combobox');
    fireEvent.change(search, { target: { value: 'no-match' } });
    expect(screen.getByText('No matching options')).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('toggles multiple namespaces without closing the picker and clears to all', () => {
  function Picker() {
    const [value, setValue] = useState('');
    return (
      <SearchableSelect
        label="Namespace"
        multiple
        onChange={setValue}
        options={[
          { label: 'All namespaces', value: '' },
          { color: 'teal', label: 'data', value: 'data' },
          { color: 'blue', label: 'renderer', value: 'renderer' },
        ]}
        value={value}
      />
    );
  }
  render(<Picker />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Namespace: All namespaces' }),
  );
  fireEvent.click(screen.getByRole('option', { name: 'data' }));
  fireEvent.click(screen.getByRole('option', { name: 'renderer' }));
  expect(
    screen.getByRole('button', { name: 'Namespace: data, renderer' }),
  ).toBeTruthy();
  expect(
    screen.getByRole('option', { name: 'data' }).getAttribute('aria-selected'),
  ).toBe('true');
  fireEvent.click(screen.getByRole('option', { name: 'data' }));
  expect(
    screen.getByRole('button', { name: 'Namespace: renderer' }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('option', { name: 'All namespaces' }));
  expect(
    screen.getByRole('button', { name: 'Namespace: All namespaces' }),
  ).toBeTruthy();
});
