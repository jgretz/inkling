import {describe, expect, it} from 'bun:test';
import {DEFAULT_DETECTORS, DEFAULT_VOICE_THRESHOLDS} from '../src/constants.ts';
import {parseRuleSet, resolveVoice, type VoiceRuleSet} from '../src/rules.ts';

/** A rule set with nothing set, so a test only states the level it is about. */
function set(partial: Partial<VoiceRuleSet> = {}): VoiceRuleSet {
  return {rules: {}, thresholds: {}, guidance: '', ...partial};
}

describe('parseRuleSet', function () {
  it('should read on and off as the booleans a writer meant them to be', function () {
    // Exactly what `yaml` produces for this block under the YAML 1.2 core
    // schema: `off` and `no` come back as strings, not booleans.
    const raw = {
      rules: {'em-dash': 'off', 'curly-quotes': false, 'banned-words': 'on', signposting: 'no'},
    };

    const {ruleSet, problems} = parseRuleSet(raw, '');

    expect(ruleSet.rules).toEqual({
      'em-dash': false,
      'curly-quotes': false,
      'banned-words': true,
      signposting: false,
    });
    expect(problems).toEqual([]);
  });

  it('should read OFF and True whatever case they were typed in', function () {
    const {ruleSet} = parseRuleSet({rules: {'em-dash': 'OFF', 'curly-quotes': 'True'}}, '');

    expect(ruleSet.rules).toEqual({'em-dash': false, 'curly-quotes': true});
  });

  it('should leave a rule enabled and report it when its value is unparseable', function () {
    const {ruleSet, problems} = parseRuleSet({rules: {'em-dash': 3}}, '');

    // Never coerced to false: a typo must not silently disable a rule.
    expect(ruleSet.rules).toEqual({});
    expect(resolveVoice([ruleSet]).detectors).toContain('em-dash');
    expect(problems).toEqual(['rules.em-dash: expected on or off, so this rule is left as it was']);
  });

  it('should report a rule id no detector answers to', function () {
    const {ruleSet, problems} = parseRuleSet({rules: {'em-dashes': 'off'}}, '');

    expect(ruleSet.rules).toEqual({});
    expect(problems).toEqual(['rules.em-dashes: no rule by that name, so it would do nothing']);
  });

  it('should keep a threshold that is a number above zero', function () {
    const {ruleSet, problems} = parseRuleSet({thresholds: {wordsPerTriplet: 300}}, '');

    expect(ruleSet.thresholds).toEqual({wordsPerTriplet: 300});
    expect(problems).toEqual([]);
  });

  it('should reject a threshold that is not a number above zero', function () {
    const {ruleSet, problems} = parseRuleSet(
      {thresholds: {wordsPerTriplet: 0, connectiveRun: '4', uniformityRatio: -1}},
      '',
    );

    expect(ruleSet.thresholds).toEqual({});
    expect(problems).toEqual([
      'thresholds.wordsPerTriplet: expected a number above zero',
      'thresholds.connectiveRun: expected a number above zero',
      'thresholds.uniformityRatio: expected a number above zero',
    ]);
  });

  it('should report a threshold name it does not know', function () {
    const {problems} = parseRuleSet({thresholds: {anchorContext: 64}}, '');

    // `anchorContext` decides the shape of every anchor, so it is deliberately
    // not settable per document.
    expect(problems).toEqual(['thresholds.anchorContext: no threshold by that name']);
  });

  it('should keep the guidance body whatever the configuration says', function () {
    const {ruleSet} = parseRuleSet({rules: {'em-dash': 'off'}}, 'Short sentences.');

    expect(ruleSet.guidance).toBe('Short sentences.');
  });

  it('should treat a document with no frontmatter as a rule set that says nothing', function () {
    const {ruleSet, problems} = parseRuleSet(undefined, 'Just prose.');

    expect(ruleSet).toEqual({rules: {}, thresholds: {}, guidance: 'Just prose.'});
    expect(problems).toEqual([]);
  });

  it('should report frontmatter that is not a block at all', function () {
    const {problems} = parseRuleSet('em-dash: off', '');

    expect(problems).toEqual(['expected a block of rules and thresholds']);
  });

  it('should report a rules key that is not a block', function () {
    const {ruleSet, problems} = parseRuleSet({rules: ['em-dash']}, '');

    expect(ruleSet.rules).toEqual({});
    expect(problems).toEqual(['rules: expected a block of rule ids, one per line']);
  });
});

describe('resolveVoice', function () {
  it('should run every default detector when no level says otherwise', function () {
    expect(resolveVoice([]).detectors).toEqual([...DEFAULT_DETECTORS]);
  });

  it('should fall back to the tuned defaults when no level moves a threshold', function () {
    expect(resolveVoice([]).thresholds).toEqual(DEFAULT_VOICE_THRESHOLDS);
  });

  it('should drop a detector a level disabled', function () {
    const resolved = resolveVoice([set({rules: {'em-dash': false}})]);

    expect(resolved.detectors).not.toContain('em-dash');
    expect(resolved.detectors).toContain('curly-quotes');
  });

  it('should let a later level re-enable a rule an earlier one disabled', function () {
    // Full override rather than narrowing: the last level wins, per key.
    const resolved = resolveVoice([
      set({rules: {'em-dash': false}}),
      set({rules: {'em-dash': true}}),
    ]);

    expect(resolved.detectors).toContain('em-dash');
  });

  it('should give the last level the threshold when several set the same one', function () {
    const resolved = resolveVoice([
      set({thresholds: {wordsPerTriplet: 100}}),
      set({thresholds: {wordsPerTriplet: 200}}),
      set({thresholds: {wordsPerTriplet: 400}}),
    ]);

    expect(resolved.thresholds.wordsPerTriplet).toBe(400);
  });

  it('should leave a threshold no level mentioned at its default', function () {
    const resolved = resolveVoice([set({thresholds: {wordsPerTriplet: 400}})]);

    expect(resolved.thresholds.connectiveRun).toBe(DEFAULT_VOICE_THRESHOLDS.connectiveRun);
  });

  it('should list detectors in registry order however the levels arrived', function () {
    const resolved = resolveVoice([
      set({rules: {'sentence-length-uniformity': false, 'em-dash': false}}),
      set({rules: {'em-dash': true}}),
    ]);

    expect(resolved.detectors).toEqual(
      DEFAULT_DETECTORS.filter(function (id) {
        return id !== 'sentence-length-uniformity';
      }),
    );
  });

  it('should keep every non-empty guidance body in cascade order', function () {
    const resolved = resolveVoice([
      set({guidance: 'Root prose.'}),
      set({guidance: '   \n'}),
      set({guidance: 'Group prose.'}),
    ]);

    expect(resolved.guidance).toEqual(['Root prose.', 'Group prose.']);
  });
});
