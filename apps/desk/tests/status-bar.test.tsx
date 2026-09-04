import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {render} from '@testing-library/react';
import {StatusBar} from '../src/components/shell/StatusBar.tsx';

autoCleanup();

describe('StatusBar', function () {
  it('should show the notice when there is one', function () {
    // Queried off the render result rather than `screen`: the global one binds
    // `document.body` before happy-dom is registered. See `setup.ts`.
    const {getByText} = render(<StatusBar notice="the vault database is unavailable" />);

    expect(getByText('the vault database is unavailable')).toBeDefined();
  });

  it('should show nothing when there is neither an error nor a notice', function () {
    const {container} = render(<StatusBar />);

    expect(container.textContent).toBe('');
  });

  it('should show the error when there is one', function () {
    const {getByText} = render(<StatusBar error="not a directory: /gone" />);

    expect(getByText('not a directory: /gone')).toBeDefined();
  });

  it('should show both when the vault failed and the database is unavailable', function () {
    const {getByText} = render(
      <StatusBar error="not a directory: /gone" notice="database unavailable" />,
    );

    expect(getByText('not a directory: /gone')).toBeDefined();
    expect(getByText('database unavailable')).toBeDefined();
  });
});
