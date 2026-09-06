import {autoCleanup} from './setup.ts';
import {describe, expect, it, mock} from 'bun:test';
import {fireEvent, render} from '@testing-library/react';
import {Splitter, type SplitterSide} from '../src/components/shell/Splitter.tsx';

autoCleanup();

/**
 * The direction rule, on both axes.
 *
 * A handle sits on the edge its panel grows from, and dragging away from the
 * panel makes it bigger. That is what puts the composer's handle above it
 * rather than at a corner below: the box is already at the bottom of the
 * window, so downwards is the one direction with no room in it.
 */

type Options = {side: SplitterSide; size?: number; onResize?: (size: number) => void};

function noop() {}

function splitter({side, size = 200, onResize = noop}: Options) {
  return render(
    <Splitter size={size} onResize={onResize} side={side} min={0} max={999} label="Resize" />,
  );
}

/** happy-dom has no pointer capture, and the handle calls it on every press. */
function drag(handle: Element, from: {x: number; y: number}, to: {x: number; y: number}) {
  Object.assign(handle, {setPointerCapture: noop, releasePointerCapture: noop});
  fireEvent.pointerDown(handle, {pointerId: 1, clientX: from.x, clientY: from.y});
  fireEvent.pointerMove(handle, {pointerId: 1, clientX: to.x, clientY: to.y});
  fireEvent.pointerUp(handle, {pointerId: 1});
}

describe('Splitter', function () {
  it('should grow a panel on its left when dragged right', function () {
    const onResize = mock(function () {});
    const {getByRole} = splitter({side: 'left', onResize});

    drag(getByRole('separator'), {x: 100, y: 0}, {x: 140, y: 0});

    expect(onResize).toHaveBeenLastCalledWith(240);
  });

  it('should grow a panel on its right when dragged left', function () {
    const onResize = mock(function () {});
    const {getByRole} = splitter({side: 'right', onResize});

    drag(getByRole('separator'), {x: 100, y: 0}, {x: 60, y: 0});

    expect(onResize).toHaveBeenLastCalledWith(240);
  });

  it('should grow a panel below it when dragged up', function () {
    // The composer. Up is the only direction it has room to grow in.
    const onResize = mock(function () {});
    const {getByRole} = splitter({side: 'bottom', onResize});

    drag(getByRole('separator'), {x: 0, y: 300}, {x: 0, y: 250});

    expect(onResize).toHaveBeenLastCalledWith(250);
  });

  it('should grow a panel above it when dragged down', function () {
    const onResize = mock(function () {});
    const {getByRole} = splitter({side: 'top', onResize});

    drag(getByRole('separator'), {x: 0, y: 300}, {x: 0, y: 350});

    expect(onResize).toHaveBeenLastCalledWith(250);
  });

  it('should report the line it draws, not the axis it travels', function () {
    const across = splitter({side: 'left'});
    expect(across.getByRole('separator').getAttribute('aria-orientation')).toBe('vertical');
    across.unmount();

    const along = splitter({side: 'bottom'});
    expect(along.getByRole('separator').getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('should take arrow keys on the axis it moves along', function () {
    const onResize = mock(function () {});
    const {getByRole} = splitter({side: 'bottom', onResize});

    fireEvent.keyDown(getByRole('separator'), {key: 'ArrowUp'});

    expect(onResize).toHaveBeenLastCalledWith(208);
  });

  it('should ignore the other axis keys', function () {
    const onResize = mock(function () {});
    const {getByRole} = splitter({side: 'bottom', onResize});

    fireEvent.keyDown(getByRole('separator'), {key: 'ArrowLeft'});

    expect(onResize).not.toHaveBeenCalled();
  });

  it('should stay inside its bounds', function () {
    const onResize = mock(function () {});
    const {getByRole} = render(
      <Splitter size={200} onResize={onResize} side="left" min={180} max={220} label="Resize" />,
    );

    drag(getByRole('separator'), {x: 100, y: 0}, {x: 900, y: 0});

    expect(onResize).toHaveBeenLastCalledWith(220);
  });
});
