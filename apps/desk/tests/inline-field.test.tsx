import {autoCleanup} from './setup.ts';
import {describe, expect, it, mock} from 'bun:test';
import {fireEvent, render} from '@testing-library/react';
import {InlineField} from '../src/components/library/InlineField.tsx';

autoCleanup();

/**
 * The three ways out of the naming field, and the one that was missing.
 *
 * Committing on blur is not a nicety. Without it the only exits are Enter and
 * Escape, neither of which is signposted anywhere, so a writer who types a name
 * and clicks away is left looking at a field that will not close and a group
 * that was never made.
 */

type Handlers = {onSubmit?: (value: string) => void; onCancel?: () => void};

function noop() {}

function field({onSubmit = noop, onCancel = noop}: Handlers = {}) {
  return render(
    <InlineField
      label="Name of the new group"
      placeholder="Group name"
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );
}

describe('InlineField', function () {
  it('should commit when focus leaves', function () {
    const onSubmit = mock(function () {});
    const {getByLabelText} = field({onSubmit});
    const input = getByLabelText('Name of the new group');

    fireEvent.change(input, {target: {value: 'essays'}});
    fireEvent.blur(input);

    expect(onSubmit).toHaveBeenCalledWith('essays');
  });

  it('should cancel when focus leaves an empty field', function () {
    const onSubmit = mock(function () {});
    const onCancel = mock(function () {});
    const {getByLabelText} = field({onSubmit, onCancel});

    fireEvent.blur(getByLabelText('Name of the new group'));

    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('should not commit twice when Enter is followed by a blur', function () {
    // Enter unmounts the field, and the DOM may fire blur on the way out.
    const onSubmit = mock(function () {});
    const {getByLabelText} = field({onSubmit});
    const input = getByLabelText('Name of the new group');

    fireEvent.change(input, {target: {value: 'essays'}});
    fireEvent.submit(input);
    fireEvent.blur(input);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('should abandon on Escape without committing what was typed', function () {
    const onSubmit = mock(function () {});
    const onCancel = mock(function () {});
    const {getByLabelText} = field({onSubmit, onCancel});
    const input = getByLabelText('Name of the new group');

    fireEvent.change(input, {target: {value: 'essays'}});
    fireEvent.keyDown(input, {key: 'Escape'});
    // Escape moves focus, so the blur it causes must not undo the abandon.
    fireEvent.blur(input);

    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('should trim what it commits', function () {
    const onSubmit = mock(function () {});
    const {getByLabelText} = field({onSubmit});
    const input = getByLabelText('Name of the new group');

    fireEvent.change(input, {target: {value: '  essays  '}});
    fireEvent.blur(input);

    expect(onSubmit).toHaveBeenCalledWith('essays');
  });
});
