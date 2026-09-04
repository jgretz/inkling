import {afterEach, describe, expect, it} from 'bun:test';
import {cleanup, render, screen} from '@testing-library/react';
import {StatusBar} from '../src/components/shell/StatusBar.tsx';

afterEach(cleanup);

describe('StatusBar', function () {
  it('should show the notice when there is one', function () {
    render(<StatusBar notice="the vault database is unavailable" />);

    expect(screen.getByText('the vault database is unavailable')).toBeDefined();
  });

  it('should show nothing when there is neither an error nor a notice', function () {
    const {container} = render(<StatusBar />);

    expect(container.textContent).toBe('');
  });

  it('should show the error when there is one', function () {
    render(<StatusBar error="not a directory: /gone" />);

    expect(screen.getByText('not a directory: /gone')).toBeDefined();
  });

  it('should show both when the vault failed and the database is unavailable', function () {
    render(<StatusBar error="not a directory: /gone" notice="database unavailable" />);

    expect(screen.getByText('not a directory: /gone')).toBeDefined();
    expect(screen.getByText('database unavailable')).toBeDefined();
  });
});
