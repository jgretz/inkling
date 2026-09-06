import {autoCleanup} from './setup.ts';
import {describe, expect, it} from 'bun:test';
import {fireEvent, render} from '@testing-library/react';
import type {FrontmatterChoice} from '../src/lib/export.ts';
import {DocMenu} from '../src/components/shell/DocMenu.tsx';

autoCleanup();

/**
 * The writer's exit, which is a thing on screen rather than a pure function.
 * Queried off the render result rather than `screen`. See `setup.ts`.
 */

type MenuProps = {
  onExport?: (choice: FrontmatterChoice) => void;
  onCopy?: () => void;
  disabled?: boolean;
};

function noop() {}

function menu({onExport = noop, onCopy = noop, disabled = false}: MenuProps = {}) {
  return render(<DocMenu onExport={onExport} onCopy={onCopy} disabled={disabled} />);
}

function openMenu(view: ReturnType<typeof menu>) {
  fireEvent.click(view.getByLabelText('Document actions'));
}

describe('DocMenu', function () {
  it('should show nothing until it is opened', function () {
    const view = menu();

    expect(view.queryByRole('menu')).toBeNull();
    expect(view.queryByText('Export…')).toBeNull();
  });

  it('should offer the three ways out when it is opened', function () {
    const view = menu();

    openMenu(view);

    expect(view.getByRole('menu')).toBeDefined();
    expect(view.getByText('Export…')).toBeDefined();
    expect(view.getByText('Export without frontmatter…')).toBeDefined();
    expect(view.getByText('Copy as rich text')).toBeDefined();
  });

  it('should keep the frontmatter when the plain export is picked', function () {
    const choices: FrontmatterChoice[] = [];
    const view = menu({
      onExport(choice) {
        choices.push(choice);
      },
    });

    openMenu(view);
    fireEvent.click(view.getByText('Export…'));

    expect(choices).toEqual(['keep']);
  });

  it('should strip the frontmatter when that export is picked', function () {
    const choices: FrontmatterChoice[] = [];
    const view = menu({
      onExport(choice) {
        choices.push(choice);
      },
    });

    openMenu(view);
    fireEvent.click(view.getByText('Export without frontmatter…'));

    expect(choices).toEqual(['strip']);
  });

  it('should ask for the copy when that item is picked', function () {
    let copied = 0;
    const view = menu({
      onCopy() {
        copied += 1;
      },
    });

    openMenu(view);
    fireEvent.click(view.getByText('Copy as rich text'));

    expect(copied).toBe(1);
  });

  it('should close after an item fires', function () {
    const view = menu();

    openMenu(view);
    fireEvent.click(view.getByText('Copy as rich text'));

    expect(view.queryByRole('menu')).toBeNull();
  });

  it('should close on Escape', function () {
    const view = menu();

    openMenu(view);
    fireEvent.keyDown(document, {key: 'Escape'});

    expect(view.queryByRole('menu')).toBeNull();
  });

  // Nothing open means nothing to give anyone, so the control refuses rather
  // than opening onto three items that would each do nothing.
  it('should not open with no document open', function () {
    const view = menu({disabled: true});

    openMenu(view);

    expect(view.queryByRole('menu')).toBeNull();
  });
});
