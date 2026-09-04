import {autoCleanup} from './setup.ts';
import {describe, expect, it, mock} from 'bun:test';
import {fireEvent, render} from '@testing-library/react';
import {check, type Finding} from '@inkling/voice';
import {FindingsStrip, type DismissedFinding} from '../src/components/findings/FindingsStrip.tsx';

autoCleanup();

const MIXED = 'A sentence — with an em dash and a hyphen - too.';

function noop() {}

/** A dismissal of the fixture's nth finding, as the app would hand one over. */
function dismissed(index: number): DismissedFinding {
  const finding = check(MIXED)[index];
  if (finding === undefined) throw new Error(`the fixture raised no finding at ${index}`);
  return {finding, by: {id: index + 1}};
}

describe('FindingsStrip', function () {
  it('should render nothing at all for a document with no findings', function () {
    const {container} = render(<FindingsStrip findings={[]} onPick={noop} />);

    expect(container.firstChild).toBeNull();
  });

  it('should count the findings and the rules they came from', function () {
    const findings = check(MIXED);
    const {getByText} = render(<FindingsStrip findings={findings} onPick={noop} />);

    expect(findings.length).toBe(2);
    expect(getByText('2 findings in 2 rules')).toBeDefined();
  });

  it('should say "1 finding in 1 rule" rather than pluralize blindly', function () {
    const {getByText} = render(
      <FindingsStrip findings={check('A sentence — with an em dash.')} onPick={noop} />,
    );

    expect(getByText('1 finding in 1 rule')).toBeDefined();
  });

  it('should start every group collapsed', function () {
    const {getAllByRole} = render(<FindingsStrip findings={check(MIXED)} onPick={noop} />);

    const groups = getAllByRole('button');

    expect(groups.length).toBe(2);
    groups.forEach(function (group) {
      expect(group.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('should list a rule label and its count on each group header', function () {
    const {getByText} = render(<FindingsStrip findings={check(MIXED)} onPick={noop} />);

    expect(getByText('Em dash')).toBeDefined();
    expect(getByText('Spaced hyphen')).toBeDefined();
  });

  it('should reveal the entries of a group when it is expanded', function () {
    const {getByText, queryByText} = render(
      <FindingsStrip findings={check(MIXED)} onPick={noop} />,
    );
    const explain =
      'use a colon if the second half explains the first, a comma for an aside, or a full stop.';

    expect(queryByText(explain)).toBeNull();

    fireEvent.click(getByText('Em dash'));

    expect(getByText(explain)).toBeDefined();
  });

  it('should toggle groups independently', function () {
    const {getByText} = render(<FindingsStrip findings={check(MIXED)} onPick={noop} />);

    fireEvent.click(getByText('Em dash'));
    fireEvent.click(getByText('Spaced hyphen'));

    const headers = [getByText('Em dash'), getByText('Spaced hyphen')];

    headers.forEach(function (header) {
      expect(header.closest('button')?.getAttribute('aria-expanded')).toBe('true');
    });
  });

  it('should hand the picked finding to onPick', function () {
    const onPick = mock(function (_finding: Finding) {});
    const findings = check(MIXED);
    const {getByText, getAllByRole} = render(<FindingsStrip findings={findings} onPick={onPick} />);

    fireEvent.click(getByText('Spaced hyphen'));
    const entry = getAllByRole('button').at(-1);
    if (entry === undefined) throw new Error('the expanded group listed no entry');
    fireEvent.click(entry);

    expect(onPick).toHaveBeenCalledWith(findings[1]);
  });

  it('should show the anchor context around a quote that is one character', function () {
    // The reason the strip reads the anchor rather than the quote: a spaced
    // hyphen's quote is `-`, which identifies nothing on its own.
    const {getByText, container} = render(<FindingsStrip findings={check(MIXED)} onPick={noop} />);

    fireEvent.click(getByText('Spaced hyphen'));

    expect(container.textContent).toContain('and a hyphen');
  });

  it('should offer no dismiss button to a caller that cannot store one', function () {
    // Which is also why the pick test above still reaches the entry button as
    // the last button in the strip.
    const {getByText, queryByLabelText} = render(
      <FindingsStrip findings={check(MIXED)} onPick={noop} />,
    );

    fireEvent.click(getByText('Em dash'));

    expect(queryByLabelText('Dismiss this Em dash')).toBeNull();
  });

  it('should hand the dismissed finding to onDismiss', function () {
    const onDismiss = mock(function (_finding: Finding) {});
    const findings = check(MIXED);
    const {getByText, getByLabelText} = render(
      <FindingsStrip findings={findings} onPick={noop} onDismiss={onDismiss} />,
    );

    fireEvent.click(getByText('Em dash'));
    fireEvent.click(getByLabelText('Dismiss this Em dash'));

    expect(onDismiss).toHaveBeenCalledWith(findings[0]);
  });

  it('should list what was dismissed in a trailing group with its own count', function () {
    const {getByText} = render(
      <FindingsStrip
        findings={check(MIXED)}
        onPick={noop}
        suppressed={[dismissed(0), dismissed(1)]}
      />,
    );

    expect(getByText('Dismissed')).toBeDefined();
    expect(getByText('Dismissed').closest('button')?.textContent).toBe('Dismissed2');
  });

  it('should name the rule of each dismissed entry, since the grouping cannot', function () {
    const {getByText, getAllByText} = render(
      <FindingsStrip findings={[]} onPick={noop} suppressed={[dismissed(1)]} />,
    );

    fireEvent.click(getByText('Dismissed'));

    expect(getAllByText('Spaced hyphen').length).toBe(1);
  });

  it('should toggle the dismissed group independently of the rule groups', function () {
    const {getByText} = render(
      <FindingsStrip findings={check(MIXED)} onPick={noop} suppressed={[dismissed(1)]} />,
    );

    fireEvent.click(getByText('Em dash'));

    expect(getByText('Dismissed').closest('button')?.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(getByText('Dismissed'));

    expect(getByText('Dismissed').closest('button')?.getAttribute('aria-expanded')).toBe('true');
    expect(getByText('Em dash').closest('button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('should hand the restored entry to onRestore', function () {
    const onRestore = mock(function (_entry: DismissedFinding) {});
    const entry = dismissed(1);
    const {getByText, getByLabelText} = render(
      <FindingsStrip
        findings={check(MIXED)}
        onPick={noop}
        suppressed={[entry]}
        onRestore={onRestore}
      />,
    );

    fireEvent.click(getByText('Dismissed'));
    fireEvent.click(getByLabelText('Restore this Spaced hyphen'));

    expect(onRestore).toHaveBeenCalledWith(entry);
  });

  it('should still render when everything in the document was dismissed', function () {
    // A dismissal the writer cannot see is one they cannot undo.
    const {getByText, queryByText} = render(
      <FindingsStrip findings={[]} onPick={noop} suppressed={[dismissed(0)]} />,
    );

    expect(getByText('Dismissed')).toBeDefined();
    expect(queryByText('0 findings in 0 rules')).toBeNull();
  });

  it('should name itself for a screen reader without announcing changes', function () {
    const {getByRole, container} = render(<FindingsStrip findings={check(MIXED)} onPick={noop} />);

    expect(getByRole('region', {name: 'Voice findings'})).toBeDefined();
    expect(container.querySelector('[aria-live]')).toBeNull();
  });
});
