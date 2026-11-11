import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';

import { FunctionPicker } from '../src/FunctionPicker';

afterEach(cleanup);
it('opens on focus, shows namespace and counts, searches and selects with keyboard', () => {
  function Picker() {
    const [value, setValue] = useState('');
    return (
      <FunctionPicker
        functions={[
          {
            calls: 12,
            errors: 0,
            maxDuration: 1,
            minDuration: 1,
            name: 'Service.load',
            namespace: 'data',
            totalDuration: 12,
          },
          {
            calls: 3,
            errors: 0,
            maxDuration: 1,
            minDuration: 1,
            name: 'Service.paint',
            namespace: 'renderer',
            totalDuration: 3,
          },
        ]}
        onChange={setValue}
        value={value}
      />
    );
  }
  render(<Picker />);
  const input = screen.getByRole('combobox');
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.focus(input);
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(
    screen.getByRole('option', { name: 'data Service.load 12 records' }),
  ).toBeTruthy();
  fireEvent.change(input, { target: { value: 'load' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect((input as HTMLInputElement).value).toBe('data.Service.load');
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.click(input);
  expect(screen.getByRole('listbox')).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('listbox')).toBeNull();
});
